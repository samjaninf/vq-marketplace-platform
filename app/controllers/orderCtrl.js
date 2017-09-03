const async = require('async');
const models = require('../models/models');
const orderEmitter = require("../events/order");
const requestEmitter = require("../events/request");

const settleOrder = (orderId, userId, cb) => {
    var requestId;
    var order;
    
    userId = Number(userId);
    orderId = Number(orderId);
    
    async.waterfall([
        cb => models.order
            .findById(orderId)
            .then(rOrder => {
                if (!rOrder) {
                    return cb('NOT_FOUND');
                }
             
                if (rOrder.userId !== userId) {
                    return cb('NOT_AUTHORIZED_TO_SETTLE');
                }

                const possibleStatusForUpdate = [
                    models.order.ORDER_STATUS.MARKED_DONE,
                    models.order.ORDER_STATUS.PENDING
                ];

                if (
                    possibleStatusForUpdate.indexOf(rOrder.status) === -1
                ) {
                    return cb('WRONG_STATUS');
                }

                return cb();
            }, cb),
        cb => models.order
            .update({
                status: models.order.ORDER_STATUS.SETTLED,
                settledAt: new Date()
            }, {
                where: {
                    id: orderId
                }
            })
            .then(rOrder => {
                order = rOrder;
                requestId = order.requestId;

                cb();
            }, cb),
        cb => {
            models.request
            .update({
                status: models.request.REQUEST_STATUS.SETTLED
            }, {
                where: {
                    id: requestId
                }
            })
            .then(() => cb(), cb)
        }
    ], err => {
        if (err) {
            return cb(err);
        }
       
        cb(null, order);

        requestEmitter
            .emit('request-settled', requestId);

        orderEmitter
            .emit('order-completed', orderId)
    });
};

module.exports = {
    settleOrder
};