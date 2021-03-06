const async = require("async");
const randomstring = require("randomstring");
const db = require("../app/models/models");
const utils = require("../app/utils");
const cryptoService = require("../app/services/cryptoService");
const subscriptionService = require("../app/services/subscriptionService");
const emailService = require("../app/services/emailService.js");
const emailTemplateGenerator = require("../app/services/emailTemplateGenerator.js");
const service = require("./service");
const hooks = require("./hooks");
const request = require("request");
const tenantModelsProvider = require("./tenantModelsProvider");

const initRoutes = (app, express) => {
    app.use(express.static(__dirname + "/public"));

    hooks.init(app, express);

    app.get("/cb/stripe", (req, res) => {
        const stripeAuthCode = req.query.code;

        let tenantId, userId;
        let appConfig;

        try {
            const splitted = req.query.state.split("@");
            
            tenantId = splitted[0];
            userId = splitted[1];
        } catch (err) {
            return res.status(400).send("Missing state param");
        }
        
        const models = db.get(tenantId);
        
        if (!models) {
            res
            .status(400)
            .send({
                code: "TENANT_NOT_FOUND"
            });

            return;
        }

        async.waterfall([
            cb => {
                models
                .appConfig
                .findAll()
                .then(rAppConfig => {
                    appConfig = rAppConfig;

                    cb();
                }, cb);
            },
            cb => {
                const stripePublicKey = appConfig.find(_ => _.fieldKey === "STRIPE_PUBLIC_KEY" && _.fieldValue);
                const stripePrivateKey = appConfig.find(_ => _.fieldKey === "STRIPE_PRIVATE_KEY" && _.fieldValue);

                if (!stripePublicKey || !stripePrivateKey) {
                    cb({
                        code: "PAYMENTS_NOT_CONFIGURED"
                    });

                    return;
                }

                request
                .post({
                    url: "https://connect.stripe.com/oauth/token",
                    form: {
                        grant_type: "authorization_code",
                        code: stripeAuthCode,
                        client_id: stripePublicKey.fieldValue,
                        client_secret: stripePrivateKey.fieldValue
                    }
                }, (err, response, body) => {
                    if (err) {
                        cb(err);
        
                        return;
                    }
        
                    const stripeAccountAccess = JSON.parse(body);
        
                    if (stripeAccountAccess.error) {
                        cb({
                            code: "PAYMENTS_ERROR",
                            err: stripeAccountAccess
                        });
                        
                        return;
                    }

                    cb(undefined, stripeAccountAccess);
                });
            },
            (stripeAccountAccess, cb) => {
                async
                .parallel([
                    cb => models
                    .userPaymentAccount
                    .findOne({
                        where: {
                            $and: [
                                {
                                    networkId: "stripe"
                                }, {
                                    userId: userId
                                }
                            ]
                        }
                    })
                    .then(paymentAccount => {
                        if (paymentAccount) {
                            return cb();
                        }

                        models
                        .userPaymentAccount
                        .create({
                            userId,
                            accountId: stripeAccountAccess.stripe_user_id,
                            networkId: "stripe"
                        }, () => cb(), cb);
                    }, cb)
                ], cb);
             }
        ], err => {
            if (err) {
                return res.status(400).send(err);
            }

            res.redirect(
                `https://${models.tenantId}.vqmarketplace.com/app/account/payments`
            );
        });
    });

    app.get("/api/tenant", (req, res) => {
        tenantModelsProvider.getModels((err, tenantModels) => {
            if (err) {
                return res.status(400).send(err);
            }

            tenantModels
                .tenant
                .findAll({
                    where: req.query
                })
                .then((rTenants) => {
                    const processedTenants = rTenants
                        .map(_ => {
                            return {
                                tenantId: _.tenantId,
                                stripePublicKey: _.stripeAccount ? _.stripeAccount.keys.publishable : undefined,
                            };
                        });

                    res.send(processedTenants);
                }, err => res.status(400).send(err));
        });
    });

    app.get("/api/tenant/:tenantId", (req, res) => {
        tenantModelsProvider.getModels((err, tenantModels) => {
            if (err) {
                return res.status(400).send(err);
            }

            tenantModels.tenant
                .findOne({
                    where: {
                        tenantId: req.params.tenantId
                    }
                })
                .then((rTenant) => {
                    if (!rTenant) {
                        return res.status(404).send({
                            code: "NOT_FOUND"
                        });
                    }

                    return res.send({
                        id: rTenant.id,
                        tenantId: rTenant.tenantId,
                        emailVerified: rTenant.emailVerified,
                        marketplaceName: rTenant.marketplaceName,
                        marketplaceType: rTenant.marketplaceType,
                        status: rTenant.status
                    });
                }, err => res.status(400).send(err));
        });
    });

    /* Trial Form User Registration Steps */
    app.post("/api/trial-registration/step-1", (req, res) => {
        const tenant = req.body;

        tenantModelsProvider.getModels((err, tenantModels) => {
            if (err) {
                return res.status(400).send(err);
            }

            tenantModels
                .tenant
                .findOrCreate({
                    where: {
                        email: tenant.email
                    },
                    defaults: {
                        apiKey: randomstring.generate(32),
                        source: tenant.source
                    }
                })
                .spread((rTenant, isNew) => {
                    if (!isNew) {
                        return res.status(400).send({
                            httpCode: 400,
                            code: "TENANT_EMAIL_TAKEN"
                        });
                    }
                    rTenant.verificationKey = cryptoService
                        .encodeObj(rTenant.apiKey);

                    var body = "<p style=\"color: #374550;\">You can copy and paste the verification code below or click the link to continue with the registration process:</p><br><br>" +
                        "<span style=\"color: #374550;\"><b>Verification Code: </b>" + rTenant.verificationKey + "</span><br><br>" +
                        "<span style=\"color: #374550;\"><b><a href=\"" + process.env.WEB_URL + "/get-started?verificationCode=" + encodeURIComponent(rTenant.verificationKey) + "\">Click here if you are unable to paste the code</a></b></span>";

                    emailTemplateGenerator.generateSingleColumnEmail(
                        "Marketplace Registration",
                        "Welcome to VQ-Marketplace",
                        body,
                        function (html) {
                            emailService.sendTemplateEmail(rTenant.email, "Welcome to VQ-Marketplace", html);
                            // we should not send here the API KEY
                            return res.send({
                                tenant: rTenant
                            });
                        }
                    );
                });
        });
    });

    app.post("/api/trial-registration/step-2", (req, res) => {

        const tenant = req.body;
        let encryptedToken = tenant.verificationCode;
        let apiKey;

        try {
            encryptedToken = encryptedToken.split(" ").join("+");
            apiKey = cryptoService.decodeObj(encryptedToken);
        } catch (err) {
            return res.status(400)
                .send({
                    httpCode: 400,
                    code: "WRONG_DATA"
                });
        }

        tenantModelsProvider.getModels((err, tenantModels) => {
            if (err) {
                return res.status(400).send(err);
            }

            tenantModels
                .tenant
                .findOne({
                    where: {
                        apiKey
                    }
                })
                .then(rTenant => {
                    if (!rTenant) {
                        return res.status(400).send({
                            httpCode: 400,
                            code: "WRONG_DATA"
                        });
                    }

                    if (rTenant.emailVerified) {
                        return res.status(400).send({
                            httpCode: 400,
                            code: "EMAIL_ALREADY_VERIFIED"
                        });
                    }

                    return rTenant
                        .update({
                            emailVerified: 1
                        })
                        .then(() => {
                            res.send({
                                tenant: rTenant
                            });
                        }, err => {
                            res.status(400).send(err);
                        });
                }, err => res.status(400).send(err));
        });
    });

    app.post("/api/trial-registration/step-3", (req, res) => {
        const tenant = req.body;

        tenantModelsProvider.getModels((err, tenantModels) => {
            if (err) {
                return res.status(400).send(err);
            }

            tenantModels
                .tenant
                .update({
                        firstName: tenant.firstName,
                        lastName: tenant.lastName,
                        country: tenant.country
                    },
                    {
                        where: {
                            apiKey: tenant.apiKey
                        }
                    })
                .then(tenant => {
                    return res.send({
                        tenant: tenant
                    });
                }, err => res.status(400).send(err));
        });
    });

    /**
     * It starts the marketplace!
     * This endpoint is called after:
     * 1) tenant has been initialized
     * 2) tenant has confirmed its email
     *
     * Here the tenant can give a marketplace.
     *
     * Request:
     * apiKey:YDJkyR6dPdeqtHd05bR3BIqUw3BA8JlM
     * marketplaceName:Adrian
     * password:hello
     * repeatPassword:hello
     */
    app.post("/api/trial-registration/step-4", (req, res) => {
        const tenant = req.body;
        const apiKey = tenant.apiKey;
        const marketplaceType = tenant.marketplaceType;
        const tenantId = utils.stringToSlug(tenant.marketplaceName);

        if (!tenantId) {
            return res.status(400)
                .send({
                    code: "MARKETPLACE_NAME_WRONG_FORMAT"
                });
        }

        const reserveredKeywords = [
            "innodb",
            "blog",
            tenantModelsProvider.rootDbName,
            "help"
        ];

        if (reserveredKeywords.indexOf(tenantId) !== -1) {
            return res.status(400)
                .send({
                    code: "MARKETPLACE_NAME_NOT_ALLOWED"
                });
        }

        let tenantModels;
        let tenantRef;

        async.waterfall([
            cb => {
                tenantModelsProvider.getModels((err, rTenantModels) => {
                    if (err) {
                        return cb(err);
                    }

                    tenantModels = rTenantModels;

                    cb();
                });
            },
            cb => tenantModels
                .tenant
                .findOne({
                    where: {
                        tenantId
                    }
                })
                .then(foundTenant => {
                    if (foundTenant) {
                        return cb({
                            httpCode: 400,
                            code: "MARKETPLACE_NAME_NOT_ALLOWED"
                        });
                    }

                    return cb();
                }, cb),
            cb => tenantModels
                .tenant
                .findOne({
                    where: {
                        apiKey: tenant.apiKey
                    }
                })
                .then(rTenant => {
                    if (!rTenant) {
                        return setTimeout(() => {
                            return cb({
                                httpCode: 400,
                                code: "WRONG_API_KEY"
                            });
                        }, 500);
                    }

                    if (!rTenant.emailVerified) {
                        return cb({
                            httpCode: 400,
                            code: "EMAIL_NOT_VERIFIED"
                        });
                    }

                    // Has api key been used?
                    if (rTenant.status !== 0) {
                        return cb({
                            httpCode: 400,
                            code: "API_KEY_USED"
                        });
                    }

                    tenantRef = rTenant;

                    cb();
                }),
            cb => {
                tenantRef.marketplaceName = tenant.marketplaceName;
                tenantRef.marketplaceType = tenant.marketplaceType;
                tenantRef.tenantId = tenantId;
                tenantRef.status = 1;

                tenantRef
                .save()
                .then(() => cb(), cb);
            }
        ], err => {
            if (err) {
                return res.status(err.httpCode).send(err);
            }
            
            const marketplaceUrl = process.env.APP_URL.replace("?tenantId?", tenantRef.tenantId);

            const configOverwrites = {
              NAME: tenantRef.marketplaceName,
              SEO_TITLE: tenantRef.marketplaceName,
              DOMAIN: marketplaceUrl
            };

            if (process.env.CHARGEBEE_SITE && process.env.CHARGEBEE_API_KEY) {
                subscriptionService.ensureCustomerDataSaved(tenantRef);
            }

            // this can last some time, up to one minute, it should be run async
            service
            .deployNewMarketplace(
                tenantId,
                apiKey,
                tenant.password,
                tenant.repeatPassword,
                marketplaceType,
                configOverwrites, () => {
                console.log("MARKETPLACE CREATED");
                
                res.send(tenantRef);

                const body = `<p style="color: #374550;">
                                Your journey to run an online marketplace has just begun! You can now easily build and manage your online marketplace and at the same time go to market, get your first users and validate your idea.
                            </p>
                            <br>
                            <p style="color: #374550;"><b>Here is your marketplace information</b></p>
                            <p style="color: #374550;"><b>- Your account's email address:</b> ${tenantRef.email}</p>
                            <p style="color: #374550; margin-bottom: 0;"><b>- Your marketplace address:</b> <a href="${marketplaceUrl}/app">${marketplaceUrl}/app</a></p>
                            <p style="color: #374550; margin:0;">This is the public address of your marketplace, the one you should share with your visitors. </p>
                            <p style="color: #374550; margin-bottom: 0;"><b>- Your marketplace admin panel:</b> <a href="${marketplaceUrl}/app/admin">${marketplaceUrl}/app/admin</a></p>
                            <p style="color: #374550; margin:0;">This is where you, as the owner, can make changes to your marketplace.</p>
                            <br>
                            
                            <p style="color: #374550;">
                                Please beware that the marketplace platform is the BETA version which means it is under development based on the feedback we collect from BETA users.
                                We would be happy if you also gave us feedback so that we can build a platform that meets your expectations. Anyone who gives feedback will be rewarded once VQ-Marketplace goes public.
                            </p>

                            <p style="color: #374550;">
                                If you need any help with configuring your marketplace or you want to contact us for a feedback, send us an email to ani@vq-labs.com.
                            </p>
                            <br>
                            <p>Cheers,<br>
                            VQ Labs Team</p>`;

                emailTemplateGenerator
                .generateSingleColumnEmail(
                    "Marketplace Registration",
                    "Welcome to your Marketplace, " + tenantRef.firstName,
                    body,
                    html => {
                        emailService.sendTemplateEmail(
                            tenantRef.email,
                            `Welcome to your Marketplace, ${tenantRef.firstName}`,
                            html
                        );
                    }
                );
            });
        });
    });

    app.post("/api/trial-registration/getTenantStatus", (req, res) => {
        const apiKey = req.body.apiKey;

        tenantModelsProvider.getModels((err, tenantModels) => {
            if (err) {
                return res.status(400).send(err);
            }

            tenantModels
                .tenant
                .findOne({
                    where: {
                        apiKey: apiKey
                    },
                    attributes: [
                        "status",
                        "tenantId"
                    ]
                })
                .then(tenant => {
                    return res.status(200).send({
                        tenant
                    });
                }, err => res.status(400).send(err));
        });
    });

    app.post("/api/trial-registration/resendVerificationCode", (req, res) => {
        const apiKey = req.body.apiKey;

        tenantModelsProvider.getModels((err, tenantModels) => {
            if (err) {
                return res.status(400).send(err);
            }

            tenantModels
                .tenant
                .findOne({
                    where: {
                        apiKey: apiKey
                    }
                })
                .then(rTenant => {
                    if (!rTenant) {
                        return res.status(400)
                            .send({
                                httpCode: 400,
                                code: "WRONG_DATA"
                            });
                    } else if (rTenant.emailVerified) {
                        return res.status(400).json({
                            httpCode: 400,
                            code: "EMAIL_ALREADY_VERIFIED",
                            tenantStatus: rTenant.status
                        });
                    } else {
                        rTenant.verificationKey = cryptoService
                            .encodeObj(rTenant.apiKey);

                        var body = "<p>You can copy and paste the verification code below or click the link to continue with the registration process:</p><br><br>" +
                            "<b>Verification Code: </b>" + rTenant.verificationKey + "<br><br>" +
                            "<b><a href=\"" + process.env.WEB_URL + "/get-started?verificationCode=" + encodeURIComponent(rTenant.verificationKey).replace(/%20/g, "+") + "\">Click here if you are unable to paste the code</a></b>";

                        emailTemplateGenerator.generateSingleColumnEmail(
                            "Marketplace Registration",
                            "Welcome to VQ-Marketplace",
                            body,
                            function (html) {
                                emailService.sendTemplateEmail(rTenant.email, "Your VQ-Marketplace Validation Code", html);
                                return res.send({
                                    tenant: rTenant
                                });
                            }
                        );

                    }
                }, err => res.status(400).send(err));
        });
    });
};


module.exports = {
    getModels: tenantModelsProvider.getModels,
    initRoutes
};
