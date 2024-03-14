const config = require("./services/config");
const path = require("path")
 // Use dotenv to read .env vars into Node
 require('dotenv').config();
 
 // Imports dependencies and set up http server
 const
   request = require('request'),
   express = require('express'),
   { urlencoded, json } = require('body-parser'),
   app = express(),
   Receive = require("./services/receive"),
   GraphApi = require("./services/graph-api"),
   User = require("./services/user")
 
// Object to store known users.
var users = {};

 // Parse application/x-www-form-urlencoded
 app.use(urlencoded({ extended: true }));
 
 // Parse application/json
 app.use(json());
 app.use(express.static(path.join(__dirname, 'public')));

//  app.get('/', (req, res) => {
//   res.sendFile(path.join(__dirname, 'public/index.html'));
// });
 // Adds support for GET requests to our webhook
 app.get('/webhook', (req, res) => {
    console.log("request received", req.query)  
   // Your verify token. Should be a random string.
   const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
 
   // Parse the query params
   let mode = req.query['hub.mode'];
   let token = req.query['hub.verify_token'];
   let challenge = req.query['hub.challenge'];
 
   // Checks if a token and mode is in the query string of the request
   if (mode && token) {
 
     // Checks the mode and token sent is correct
     if (mode === 'subscribe' && token === VERIFY_TOKEN) {
 
       // Responds with the challenge token from the request
       console.log('WEBHOOK_VERIFIED');
       res.status(200).send(challenge);
 
     } else {
       // Responds with '403 Forbidden' if verify tokens do not match
       res.sendStatus(403);
     }
   }
 });
 

 app.post("/webhook", (req, res) => {
  let body = req.body;

  console.log(`\u{1F7EA} Received webhook:`);
  console.dir(body, { depth: null });

  // Check if this is an event from a page subscription
  if (body.object === "instagram") {
    // Return a '200 OK' response to all requests
    res.status(200).send("EVENT_RECEIVED");

    // Iterate over each entry - there may be multiple if batched
    body.entry.forEach(async function(entry) {
      // Handle Page Changes event
      if ("changes" in entry) {
        let receiveMessage = new Receive();
        if (entry.changes[0].field === "comments") {
          let change = entry.changes[0].value;
          if (entry.changes[0].value) console.log("Got a comments event");
          return receiveMessage.handlePrivateReply("comment_id", change.id);
        }
      }

      if (!("messaging" in entry)) {
        console.warn("No messaging field in entry. Possibly a webhook test.");
        return;
      }

      // Iterate over webhook events - there may be multiple
      entry.messaging.forEach(async function(webhookEvent) {
        // Discard uninteresting events
        if (
          "message" in webhookEvent &&
          webhookEvent.message.is_echo === true
        ) {
          console.log("Got an echo");
          return;
        }

        // Get the sender IGSID
        let senderIgsid = webhookEvent.sender.id;

        if (!(senderIgsid in users)) {
          // First time seeing this user
          let user = new User(senderIgsid);
          let userProfile = await GraphApi.getUserProfile(senderIgsid);
          if (userProfile) {
            user.setProfile(userProfile);
            users[senderIgsid] = user;
            console.log(`Created new user profile`);
            console.dir(user);
          }
        }
        let receiveMessage = new Receive(users[senderIgsid], webhookEvent);
        // if (webhookEvent.message) {
        //   handleMessage(senderIgsid, webhookEvent.message);
        // } else if (webhookEvent.postback) {
        //   handlePostback(senderIgsid, webhookEvent.postback);
        // }
        return receiveMessage.handleMessage();
      });
    });
  } else if (body.object === "page") {
         // Iterates over each entry - there may be multiple if batched
      body.entry.forEach(function(entry) {

      // Gets the body of the webhook event
      let webhookEvent = entry.messaging[0];

      // Get the sender PSID
      let senderPsid = webhookEvent.sender.id;
      console.log('Sender PSID: ' + senderPsid);

      // Check if the event is a message or postback and
      // pass the event to the appropriate handler function
      if (webhookEvent.message) {
        handleMessage(senderPsid, webhookEvent.message);
      } else if (webhookEvent.postback) {
        handlePostback(senderPsid, webhookEvent.postback);
      }
    });
    // Returns a '200 OK' response to all requests
    res.status(200).send('EVENT_RECEIVED');
  } else {
    // Return a '404 Not Found' if event is not recognized
    console.warn(`Unrecognized POST to webhook.`);
    res.sendStatus(404);
  }
});
 
 // Handles messages events
 function handleMessage(senderPsid, receivedMessage) {
   let response;
 
   // Checks if the message contains text
   if (receivedMessage.text) {
     // Create the payload for a basic text message, which
     // will be added to the body of your request to the Send API
     response = {
       'text': `Você em enviou a mensagem: '${receivedMessage.text}'. Tente me enviar uma imagem!`
     };
   } else if (receivedMessage.attachments) {
 
     // Get the URL of the message attachment
     let attachmentUrl = receivedMessage.attachments[0].payload.url;
     response = {
       'attachment': {
         'type': 'template',
         'payload': {
           'template_type': 'generic',
           'elements': [{
             'title': 'Foi essa imagem que você me enviou?',
             'subtitle': 'Escolha um dos botões:',
             'image_url': attachmentUrl,
             'buttons': [
               {
                 'type': 'postback',
                 'title': 'Sim!',
                 'payload': 'yes',
               },
               {
                 'type': 'postback',
                 'title': 'Não!',
                 'payload': 'no',
               }
             ],
           }]
         }
       }
     };
   }
 
   // Send the response message
   callSendAPI(senderPsid, response);
 }
 
 // Handles messaging_postbacks events
 function handlePostback(senderPsid, receivedPostback) {
   let response;
 
   // Get the payload for the postback
   let payload = receivedPostback.payload;
 
   // Set the response based on the postback payload
   if (payload === 'yes') {
     response = { 'text': 'Obrigado!' };
   } else if (payload === 'no') {
     response = { 'text': 'Oops, tente me enviar outra coisa.' };
   }
   // Send the message to acknowledge the postback
   callSendAPI(senderPsid, response);
 }
 
 // Sends response messages via the Send API
 function callSendAPI(senderPsid, response) {
 
   // The page access token we have generated in your app settings
   const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
 
   // Construct the message body
   let requestBody = {
     'recipient': {
       'id': senderPsid
     },
     'message': response
   };
 
   // Send the HTTP request to the Messenger Platform
   request({
     'uri': 'https://graph.facebook.com/v14.0/me/messages',
     'qs': { 'access_token': PAGE_ACCESS_TOKEN },
     'method': 'POST',
     'json': requestBody
   }, (err, _res, _body) => {
     if (!err) {
       console.log('Message sent!');
     } else {
       console.error('Unable to send message:' + err);
     }
   });
 }
 async function main() { 
   config.checkEnvVariables();
  
  //  await GraphApi.setPageSubscriptions();
   // listen for requests :)
   var listener = app.listen(process.env.PORT, function() {
     console.log('Your app is listening on port ' + listener.address().port);
   });

 }

 main()