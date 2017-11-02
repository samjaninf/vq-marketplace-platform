const ejs = require("ejs");
const mandrill = require('mandrill-api/mandrill');
const config = require("../config/configProvider.js")();
const cust = require("../config/customizing.js");
const custProvider = require("../config/custProvider.js");
const unescape = require("unescape");

const mandrill_client = new mandrill.Mandrill(config.mandrill);

const EMAILS = {
	WELCOME: "welcome",
	PASSWORD_RESET: "password-reset",
	REQUEST_SENT: "new-request-sent",
	REQUEST_RECEIVED: "new-request-received",
	NEW_LISTING: "new-task"
};

const checkIfShouldSendEmail = (models, emailCode, userId, cb, shouldNotCb) => models
	.userProperty
	.findOne({
		where: {
			$and: [
				{
					propKey: 'EMAIL_' + emailCode,
				}, {
					propValue: '1'
				}, {
					userId
				}
			]
		}
	})
	.then(isDeactived => {
		if (!isDeactived) {
			return cb();
		}

		if (shouldNotCb) {
			shouldNotCb();
		}
	}, err => {
		console.error(err);
	});

const getEmailBody = (models, code) => models.post
	.findOne({ 
		where: {
			$and: [
				{
					type: 'email',
				}, {
					code
				}
			]
	}});

const getEmailAndSend = (models, emailCode, email, emailData) => getEmailBody(models, emailCode)
	.then(emailBody => {
		const params = {};
		var compiledEmail;
		
		if (!emailBody) {
			return console.error(`Email template "${emailCode}" has not been found`);
		}

		if (typeof emailData === 'string') {
			emailData = {
				ACTION_URL: emailData,
				LISTING_TITLE: '<LISTING_TITLE NOT SPECIFIED>',
				SENDER_FIRST_NAME: '<SENDER_FIRST_NAME NOT SPECIFIED>',
				SENDER_LAST_NAME: '<SENDER_LAST_NAME NOT SPECIFIED>',
				MESSAGE_BODY: '<MESSAGE_BODY NOT SPECIFIED>'
			};
		} else {
			emailData = {
				ACTION_URL: emailData.ACTION_URL || '<ACTION_URL NOT SPECIFIED>',
				LISTING_TITLE: emailData.LISTING_TITLE || '<LISTING_TITLE NOT SPECIFIED>',
				SENDER_FIRST_NAME: emailData.SENDER_FIRST_NAME || '<SENDER_FIRST_NAME NOT SPECIFIED>',
				SENDER_LAST_NAME: emailData.SENDER_LAST_NAME || '<SENDER_LAST_NAME NOT SPECIFIED>',
				MESSAGE_BODY: emailData.MESSAGE_BODY || '<MESSAGE_BODY NOT SPECIFIED>'
			};
		}

		try {
			compiledEmail = ejs.compile(unescape(emailBody.body))(emailData);
		} catch (err) {
			return console.error(err);
		}
		

		params.subject = emailBody.title;

		return sendEmail(models, compiledEmail, typeof email === 'string' ? [
			email
		] : email, params, (err, res) => {
			if (err) {
				console.error(err);
			}
		});
	});

const sendResetPasswordEmail = (models, email, ACTION_URL) => {
	getEmailBody(models, EMAILS.PASSWORD_RESET)
	.then(emailBody => {
		const params = {};

		const compiledEmail = ejs.compile(unescape(emailBody.body))({
			ACTION_URL
		});

		params.subject = emailBody.title;

		return sendEmail(compiledEmail, [
			email
		], params, (err, res) => {
			if (err) {
				console.error(err);
			}
		});
	});
};

const sendWelcome = (models, user, VERIFICATION_LINK) => {
	getEmailBody(models, EMAILS.WELCOME)
	.then(emailBody => {
		const params = {};

		const compiledEmail = ejs.compile(unescape(emailBody.body))({
			VERIFICATION_LINK
		});

		params.subject = emailBody.title;

		return sendEmail(models, compiledEmail, [
			user.emails[0]
		], params, (err, res) => {
			if (err) {
				console.error(err);
			}
		});
	});
};

const sendNewTenant = (email, VERIFICATION_LINK) => {
	const emailBody = `
		<%- VERIFICATION_LINK %>
	`;

	const params = {};

	const html = ejs.compile(unescape(emailBody))({
		VERIFICATION_LINK
	});

	params.subject = 'Verify your email';

	const message = getRawMessagePrototype();

	message.subject = params.subject;
	message.html = html;
	message.text = html;
	message.to = [{
		email,
		type: "to"
	}];

	var lAsync = false;
	var ip_pool = "Main Pool";

	mandrill_client
	.messages
	.send({ 
		"message": message,
		"async": lAsync,
		"ip_pool": ip_pool
	}, result => {
		console.log(result);
	}, e => {
		console.log('A mandrill error occurred: ' + e.name + ' - ' + e.message);
	});	
};

const getRawMessagePrototype = (fromName, supportEmail, domain) => ({
	"from_email": "noreply@vq-labs.com",
	"from_name": fromName,
	"to": [ ],
	"headers": {
		"Reply-To": supportEmail
	},
	"important": false,
	"global_merge_vars": [],
	"metadata": {
		"website": domain
	},
	"recipient_metadata": [{}],
});


const getMessagePrototype = models => new Promise((resolve, reject) => {
	custProvider
	.getConfig(models)
	.then(config => {
		return resolve(getRawMessagePrototype(config.NAME || "VQ LABS", config.SUPPORT_EMAIL, config.DOMAIN));
	}, reject);
});

function sendEmail (models, html, tEmails, params, callback) {
	getMessagePrototype(models)
	.then(message => {
		message.subject = params.subject;
		message.html = html;
		message.text = html;
		message.to = tEmails.map(email => {
			return {
				email,
				type: "to"
			};
		});
	
		var lAsync = false;
		var ip_pool = "Main Pool";
	
		mandrill_client
		.messages
		.send({ 
			"message": message,
			"async": lAsync,
			"ip_pool": ip_pool
		}, result => {
			console.log(result);
	
			if (callback) {
				callback(null, result);
			}
		}, e => {
			console.log('A mandrill error occurred: ' + e.name + ' - ' + e.message);
	
			return callback(e);
		});	
	});
}

module.exports = {
	EMAILS,
	checkIfShouldSendEmail,
	getEmailAndSend,
	sendEmail,
	sendWelcome,
	sendNewTenant
};
