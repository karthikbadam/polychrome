var screenCount = 1;
var screenIndex = 1;
var deviceId = "";
var screenWidth = 10;
var screenHeight = 10;
var hostname = '';
var port = '';

var idealWidth = 1920;
var idealHeight = 1080;

/* parse page URL to get peerId and screen details*/
var selfUrl = document.URL;
var idCheck = /[?&]peerId=([^&]+)/i;
var spaceCheck = /[?&]spaceConfig=([^&]+)/i;
var displayCheck = /[?&]displayConfig=([^&]+)/i;
var hostCheck = /[?&]host=([^&]+)/i;
var portCheck = /[?&]port=([^&]+)/i;

/* Firebase */
var fb; 

// connect to firebase
fb = new Firebase("https://shining-fire-9102.firebaseio.com/");


/* generate a random string if no ID is present */
function randomString(len, charSet) {
    charSet = charSet || 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    var randomString = '';
    for (var i = 0; i < len; i++) {
        var randomPoz = Math.floor(Math.random() * charSet.length);
        randomString += charSet.substring(randomPoz, randomPoz + 1);
    }
    return randomString;
}

function FireBaseObject (ID, attributes) {

    var uniqueID = this.uniqueID = ID || randomString(5);
    var _self = this; 

    if (attributes) {
        //assuming attributes are key value pairs
        var keys = Object.keys(attributes);
        keys.forEach(function (key) {
            _self[key] = attributes[key];
        });
    }

    fb.on("value", function(data) {
      var attributes = data.val() ? data.val().uniqueID : "";
      if (attributes) {
          //assuming attributes are key value pairs
          var keys = Object.keys(attributes);
          keys.forEach(function (key) {
          _self[key] = attributes[key];
          });
      }
    });
}

FireBaseObject.prototype.update = function () {
    
    var _self = this; 
    var uniqueID = _self.uniqueID; 

    //add handler here 
    fb.set({ 
       uniqueID: this
    });
}


$(document).ready(function () {

    
    // create a way to make new variables
    fb.on('child_added', function (data) {
      var newObject = data.val();
      var uniqueID = Object.keys(newObject);
      var attributes = newObject[uniqueID]; 

      var data = FireBaseObject(uniqueID, attributes);

    });

    // handlers for updating variables

    // handlers for changing variables to local display settings

}