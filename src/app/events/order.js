const EventEmitter = require("events");
const async = require("async");
const emailService = require("../services/emailService.js");
const vqAuth = require("../auth");

class DefaultEmitter extends EventEmitter {}

var orderEmitter = new DefaultEmitter();

const getOrderOwnerEmails = (models, orderId, cb) => {
    let emails, supplyEmails, supplyUserId, demandUserId, order, task, request;

    return async.waterfall([
        cb => models
            .order
            .findOne({
                where: {
                    id: orderId
                },
                include: [
                    { model: models.task },
                    { model: models.user },
                    { 
                        model: models.request,
                        include: [
                            { model: models.user, as: "fromUser" },
                            { model: models.user, as: "toUser" }
                        ]
                    }
                ]
            })
            .then(rOrder => {
                if (!rOrder) {
                    return cb({
                        code: "ORDER_NOT_FOUND"
                    });
                }
                
                order = rOrder;
                task = rOrder.task;
                request = rOrder.request;

                supplyUserId = request.fromUser.id === order.user.id ?
                    request.toUser.id :
                    request.fromUser.id;

                demandUserId = order.user.id;

                return cb();
            }, cb),

        // get demand user emails
        cb => vqAuth
            .getEmailsFromUserId(models, order.user.vqUserId, (err, rUserEmails) => {
                if (err) {
                    return cb(err);
                }

                emails = rUserEmails
                    .map(_ => _.email);

                return cb();
            }),

        // get supplier emails
        cb => {
            const vqSupplyUserId = request.fromUser.vqUserId === order.user.vqUserId ?
                    request.toUser.vqUserId :
                    request.fromUser.vqUserId;

            vqAuth
            .getEmailsFromUserId(models, vqSupplyUserId,
                (err, rUserEmails) => {
                    if (err) {
                        return cb(err);
                    }

                    supplyEmails = rUserEmails
                        .map(_ => _.email);

                    return cb();
            });
        }
        ], err => {
            return cb(err, {
                demandUserId,
                supplyUserId,
                task,
                order,
                emails,
                supplyEmails
            });
        });
};

const orderEventHandlerFactory = (emailCode, actionUrlFn) => {
	return (models, orderId) => {
        var order, task;
        var domain;
		var demandEmails, supplyEmails, demandUserId, supplyUserId;

		async.waterfall([
			cb => getOrderOwnerEmails(models, orderId, (err, data) => {
                if (err) {
                    return cb(err);
                }

                demandUserId = data.demandUserId;
                supplyUserId = data.supplyUserId;
                supplyEmails = data.supplyEmails;
                demandEmails = data.emails;
                order = data.order;
                task = data.task;

                cb();
            }),
			cb => models
				.appConfig
				.findOne({
					where: {
						fieldKey: "DOMAIN"
					}
				})
				.then(configField => {
					configField = configField || {};
					
					domain = configField.fieldValue || "http://localhost:3000";

					cb();
				}, cb)
		], err => {
			if (err) {
				return console.error(err);
			}
            
            const ACTION_URL = actionUrlFn(domain, order.requestId, order.id, 1);
            const SUPPLY_ACTION_URL = actionUrlFn(domain, order.requestId, order.id, 2);
            const emailData = {
                ACTION_URL,
                SUPPLY_ACTION_URL,
                LISTING_TITLE: task.title,
                ORDER_ID: order.id,
                ORDER_CURRENCY: order.currency,
                ORDER_AMOUNT: order.amount,
                ORDER_CREATED_AT: order.createdAt
            };

            // new more general email handling
            if (
                emailCode === "new-order" ||
                emailCode === "order-closed" ||
                emailCode === "order-completed" ||
                emailCode === "order-marked-as-done"
            ) {
                emailService.sendEmailsOnEvent(models, emailCode, demandEmails, supplyEmails, emailData);
            } else {
                // old email handling
                emailService
                .checkIfShouldSendEmail(models, emailCode, order.userId, () =>
                    emailService
                    .getEmailAndSend(models, emailCode, demandEmails, emailData)
                );
            }
		});
    };
};

orderEmitter
    .on("closed",
        orderEventHandlerFactory("order-closed", (domain, requestId, orderId, userType) =>
            `${domain}/app/${userType === 1 ? "order" : "request"}/${userType === 1 ? orderId : requestId}/review`
        )
    );

orderEmitter
	.on("order-completed", 
        orderEventHandlerFactory("order-completed", (domain, requestId, orderId, userType) =>
            `${domain}/app/${userType === 1 ? "order" : "request"}/${userType === 1 ? orderId : requestId}/review`
        )
    );    

orderEmitter
    .on("new-order", 
        orderEventHandlerFactory("new-order", (domain, requestId) =>
            `${domain}/app/chat/${requestId}`
        )
    );

orderEmitter
	.on("order-marked-as-done", 
        orderEventHandlerFactory("order-marked-as-done", (domain, requestId, orderId, userType) =>
            userType === 1 ? `${domain}/app/chat/${requestId}` : `${domain}/app/dashboard`
        )
    );

module.exports = orderEmitter;
