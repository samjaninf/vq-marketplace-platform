const responseController = require("../controllers/responseController.js");
const isLoggedIn = responseController.isLoggedIn;

module.exports = app => {
  app.get("/api/user/:userId/preference", (req, res) => {
    req.models
    .userPreference
    .findAll({ 
        where: { 
            userId: req.params.userId 
        }
    })
    .then(
      data => responseController.sendResponse(res, null, data), 
      err => responseController.sendResponse(res, err)
    );
  });

  app.get("/api/user/:userId/preference/:type", (req, res) => {
    req.models.userPreference.findAll({
      where: {
          $and: [
              { userId: req.params.userId },
              { type: req.params.type },
          ]
      }
    })
    .then(
      data => responseController.sendResponse(res, null, data), 
      err => responseController.sendResponse(res, err)
    );
  });

  app.post("/api/user/:userId/preference", isLoggedIn, (req, res) => {
    const preference = {
        userId: req.user.id,
        type: "category",
        value: req.body.value
    };
    
    req.models.userPreference
    .findOne({
        where: {
            $and: [
                { userId: preference.userId },
                { type: preference.type },
                { value: preference.value }
            ]
        }
    })
    .then(rPreference => {
        if (rPreference) {
            const updatedPreference = rPreference;

            updatedPreference.value = preference.value;

            req.models.userPreference
                .update({
                    value: preference.value
                }, {
                    where: [
                        { id: rPreference.id }
                    ]
                })
                .then(() => {
                    responseController.sendResponse(res, null, updatedPreference);
                }, err => responseController.sendResponse(res, err));
        } else {
            req.models.userPreference
                .create(preference)
                .then(rCreatedPreference => {
                    responseController.sendResponse(res, null, rCreatedPreference);
                }, err => responseController.sendResponse(res, err));
        }
    });
  });

    app.delete("/api/user/:userId/preference/:preferenceId", isLoggedIn, (req, res) => {
        const preference = {
            id: req.params.preferenceId,
            userId: req.user.id,
        };
        
        req.models.userPreference
            .destroy({
                where: {
                    $and: [
                        { userId: preference.userId },
                        { id: preference.id }
                    ]
                }
            })
            .then(() => {
                responseController.sendResponse(res, null, { desc: "Deleted "});
            }, err => responseController.sendResponse(res, err));
    });
};
