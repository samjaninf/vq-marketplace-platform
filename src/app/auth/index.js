const async = require("async");
const randomToken = require("random-token");
const AuthService = require("./services/AuthService");
const SignupCtrl = require("./controllers/SignupCtrl");
const AuthCtrl = require("./controllers/AuthCtrl");
const LoginCtrl = require("./controllers/LoginCtrl");

const localSignup = (models, email, password, cb) => {
    SignupCtrl.createLocalAccount(models, email, password, (err, authUser) => {
        return cb(err, authUser);
    });
};

const requestPasswordReset = (models, email, cb) => {
    var userEmail, userId;

    async.waterfall([
        cb => models
            .userEmail
            .findOne({
                where: {
                    $and: [
                        { email }
                    ]
                }
            })
            .then(rUserEmail => {
                if (!rUserEmail) {
                    return setTimeout(() => {
                        return cb("EMAIL_NOT_FOUND");
                    }, 100);
                }

                userEmail = rUserEmail;
                userId = userEmail.userId;

                return cb();
            }, cb),
        cb => models.userResetCode
            .create({
                userId: userEmail.userId,
                code: randomToken(64)
            })
            .then(rCode => {
                cb(null, rCode);
            }, cb)
    ], (err, resetCode) => cb(err, resetCode));
};

const resetPassword = (models, resetCode, newPassword, cb) => {
    const code = resetCode;
    let userId;

    async.waterfall([
        cb => models
            .userResetCode
            .findOne({
                where: {
                    $and: [
                        { code }
                    ]
                }
            })
            .then(rUserResetCode => {
                if (!rUserResetCode) {
                    return setTimeout(() =>
                        cb("WRONG_RESET_CODE"),
                        500
                    );
                }

                userId = rUserResetCode.userId;

                return cb();
            }, cb),
        cb => {
            return models.userResetCode
            .destroy({
                where: {
                    $and: [
                        { userId }
                    ]
                }
            })
            .then(_ => cb(), cb);
        },
        cb => {
            return models.userResetCode
            .destroy({
                where: {
                    $and: [
                        { userId }
                    ]
                }
            })
            .then(_ => cb(), cb);
        },
        cb => AuthService.createNewPassword(models, userId, newPassword, cb)
    ], err => {
        cb(err);
    });
};

const getEmailsFromUserId = (models, userId, cb) => {
    return AuthService
        .getEmailsFromUserId(models, userId, (err, vqUser) => {
            return cb(err, vqUser);	
        });
};

const getAuthUserIdFromEmail = (models, email, cb) => {
    return AuthService
        .getUserIdFromEmail(models, email, (err, vqUser) => {
            return cb(err, vqUser);	
        });
};

const localLogin = (models, email, password, cb) => {
    LoginCtrl
    .loginWithPassword(models, email, password, (err, rUser) => {
        return cb(err, rUser);
    });
};

const checkToken = (models, authToken, cb) => {
    AuthCtrl.checkToken(models, authToken, (err, rAuthUser) => {
        return cb(err, rAuthUser);
    });
};

const changePassword = (models, userId, currentPassword, newPassword, cb) => {
    AuthService
    .checkPassword(models, userId, currentPassword, (err, isCorrect) => {
        if (err) {
            return cb(err);
        }

        if (isCorrect) {
            AuthCtrl.changePassword(models, userId, newPassword);

            return cb();
        }

        return cb({
            status: 400,
            code: "WRONG_PASSWORD"
        });
    });
};

module.exports = {
    checkToken,
    localLogin,
    changePassword,
    getAuthUserIdFromEmail,
    getEmailsFromUserId,
    localSignup,
    requestPasswordReset,
    resetPassword
};