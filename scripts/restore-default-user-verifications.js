const models = require('../src/app/models/models.js');

models
    .appUserVerification
    .restoreDefault()
    .then(() => {
        console.log('Success');

        process.exit();
    }, err => {
        throw new Error(err);
    });

