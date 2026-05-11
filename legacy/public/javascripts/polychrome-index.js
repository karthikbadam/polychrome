/**
 * @author Karthik Badam
 * created in Feb 2014
 */

/* default mirror */ 
var spaceConfiguration = 1; 
var displayConfiguration = 1; 


function randomString(len, charSet) {
	charSet = charSet || 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
	var randomString = '';
	for (var i = 0; i < len; i++) {
		var randomPoz = Math.floor(Math.random() * charSet.length);
		randomString += charSet.substring(randomPoz, randomPoz + 1);
	}
	return randomString;
}

$(document).ready(function () {

    var peerId = randomString(10);
    $('#pid').text(peerId);

    $("#url_submit").click(function () {
        var url = $("#url").val();
        var sendData = {};
        sendData['url'] = url;
        sendData['space'] = spaceConfiguration;
        sendData['display'] = displayConfiguration;
        sendData['peerId'] = peerId;

        $.post("/loadUrl", sendData, function (data, error) {
            if (error)
                console.log(error)
            var win = window.open(data, '_blank');
            win.focus();
            console.log("URL --" + url + " loaded");
        });
    });

    //Clone 
    $("#one-screen").click(function () {
        spaceConfiguration = 1;
        displayConfiguration = 1;
    });

    //two screen left
    $("#two-screen-left").click(function () {
        spaceConfiguration = 2;
        displayConfiguration = 1;
    });

    //two screen left
    $("#two-screen-right").click(function () {
        spaceConfiguration = 2;
        displayConfiguration = 2;
    });

    //four screen left top
    $("#four-screen-left-top").click(function () {
        spaceConfiguration = 4;
        displayConfiguration = 1;
    });

    //four screen right top
    $("#four-screen-right-top").click(function () {
        spaceConfiguration = 4;
        displayConfiguration = 2;
    });

    //four screen left bottom
    $("#four-screen-left-bottom").click(function () {
        spaceConfiguration = 4;
        displayConfiguration = 3;
    });

    //four screen right bottom
    $("#four-screen-right-bottom").click(function () {
        spaceConfiguration = 4;
        displayConfiguration = 4;
    });

    //six screen left top
    $("#six-screen-left-top").click(function () {
        spaceConfiguration = 6;
        displayConfiguration = 1;
    });

    //six screen middle top
    $("#six-screen-middle-top").click(function () {
        spaceConfiguration = 6;
        displayConfiguration = 2;
    });

    //six screen right top
    $("#six-screen-right-top").click(function () {
        spaceConfiguration = 6;
        displayConfiguration = 3;
    });

    //six screen left bottom
    $("#six-screen-left-bottom").click(function () {
        spaceConfiguration = 6;
        displayConfiguration = 4;
    });

    //six screen middle bottom
    $("#six-screen-middle-bottom").click(function () {
        spaceConfiguration = 6;
        displayConfiguration = 5;
    });

    //six screen right bottom
    $("#six-screen-right-bottom").click(function () {
        spaceConfiguration = 6;
        displayConfiguration = 6;
    });
});