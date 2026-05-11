/**
 * @author Karthik Badam
 * created in March 2014
 */

var screenCount = 1;
var screenIndex = 1;
var myclick = false;
var deviceId = "";
var scaleX = 1;
var scaleY = 1;
var screenWidth = 10;
var screenHeight = 10;
var documentOrigin = {
    x: 0,
    y: 0
};
var hostname = '';
var port = '';

var idealWidth = 1920;
var idealHeight = 1080;

/* define event capture state */
var eventCapture = {};
eventCapture.click = true;
eventCapture.touchstart = true;
eventCapture.touchmove = true;
eventCapture.touchend = true;
eventCapture.mousedown = true;
eventCapture.mousemove = true;
eventCapture.mouseup = true;
var isMouseDown = false;

/* parse page URL to get peerId and screen details*/
var selfUrl = document.URL;
var idCheck = /[?&]peerId=([^&]+)/i;
var spaceCheck = /[?&]spaceConfig=([^&]+)/i;
var displayCheck = /[?&]displayConfig=([^&]+)/i;
var hostCheck = /[?&]host=([^&]+)/i;
var portCheck = /[?&]port=([^&]+)/i;

/* get peerId */
var match = idCheck.exec(selfUrl);
if (match != null) {
    deviceId = match[1];
} else {
    deviceId = randomString(10);
}

/* get peer configurations */
match = spaceCheck.exec(selfUrl);
if (match != null) {
    screenCount = parseInt(match[1]);
} else {
    screenCount = 1;
}

match = displayCheck.exec(selfUrl);
if (match != null) {
    screenIndex = parseInt(match[1]);
} else {
    screenIndex = 1;
}

match = hostCheck.exec(selfUrl);
if (match != null) {
    hostname = match[1];
} else {
    hostname = window.location.hostname.split(":")[0];
}

match = portCheck.exec(selfUrl);
if (match != null) {
    port = '' + match[1];
} else {
    port = "3000";
}

/* arraylist of all connections */
var connections = [];
var globalElement = null;

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

/* default event options */
var defaultOptions = {
    pointerX: 0,
    pointerY: 0,
    button: 0,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    bubbles: true,
    cancelable: true
};

/* event types */
var eventMatchers = {
    'HTMLEvents': /^(?:load|unload|abort|error|select|change|submit|reset|focus|blur|resize|scroll)$/,
    'MouseEvents': /^(?:click|dblclick|mouse(?:down|up|over|move|out))$/
}

/* simulate the Mouse event */
function simulateMouseEvent(element, eventType, options) {
    var oEvent = null;

    if (document.createEvent) {
        oEvent = document.createEvent("MouseEvents");

        /* recognize that this is PolyChrome event */
        oEvent.isPolyChrome = true;
        oEvent.initMouseEvent(eventType, options.bubbles, options.cancelable, document.defaultView,
            1, options.pointerX, options.pointerY, options.pointerX, options.pointerY,
            options.ctrlKey, options.altKey, options.shiftKey, options.metaKey, options.button, element);
        element.dispatchEvent(oEvent);
        return true;

    } else {

        options.clientX = options.pointerX;
        options.clientY = options.pointerY;
        var evt = document.createEventObject();
        evt.isPolyChrome = true;
        oEvent = extend(evt, options);
        element.fireEvent('on' + eventType, oEvent);
        return true;
    }
    return false;
}

/* simulate the HTML event */
function simulateHTMLEvent(element, eventType, options) {
    var oEvent = null;

    if (document.createEvent) {
        oEvent = document.createEvent("HTMLEvents");
        oEvent.isPolyChrome = true;
        oEvent.initEvent(eventType, options.bubbles, options.cancelable);
        element.dispatchEvent(oEvent);
        return true;

    } else {

        options.clientX = options.pointerX;
        options.clientY = options.pointerY;
        var evt = document.createEventObject();
        evt.isPolyChrome = true;
        oEvent = extend(evt, options);
        element.fireEvent('on' + eventType, oEvent);
        return true;
    }
    return false;
}

function extend(destination, source) {
    for (var property in source)
        destination[property] = source[property];
    return destination;
}

/* Method to execute an event */
var executeEventOnPosition = function (eventType, eventName, posX, posY, targetName, targetId) {

    var pageX = posX;
    var pageY = posY;
    var elem = $("#" + targetId).get(0);

    if (targetId == null || eventType == "mousedown" || eventType == "click") {
        //var removeElements = [];
        //removeElements.push("#pc-event-capturerSVG");
        //removeElements.push("#pc-event-capturer");
        //var hits = $.nearest({ x: pageX, y: pageY, removeElements: removeElements });

        //for (var i = 0; i < hits.length; i++) {
        //    globalElement = hits[i];
        //    
        //}

        $('#pc-event-capturer').css({
            "display": "none"
        });
        globalElement = document.elementFromPoint(pageX, pageY);
        $('#pc-event-capturer').css({
            "display": "initial"
        });

    }



    if (elem && eventName == "HTMLEvents") {
        /* copying the defaultOptions */
        var options = new Object();
        options = extend(options, defaultOptions);
        simulateHTMLEvent(elem, eventType, options);
    } else if (elem) {
        /* copying the defaultOptions */
        var options = new Object();
        options = extend(options, defaultOptions);
        options.pointerX = pageX;
        options.pointerY = pageY;
        simulateMouseEvent(elem, eventType, options);
    }
}

function makeMessage(eventType, message) {
    var data = new Object();

    //message for click events 
    if (eventType == "click") {
        data.eventType = "click";
        data.message = message;
    }

    //message for scroll events
    if (eventType == "scroll") {
        data.eventType = "scroll";
    }
    return data;
}

/* Method for adding event details to UI */
var addEventFeedback = function (connectedClientId, eventType, posX, posY) {
    $('#polychrome-events-dump').prepend('<div class="polychrome-event-element">' + eventType + ' for ' + connectedClientId + ' at ' + posX + ", " + posY + ' </div>');
}

/* Method to add new peer details to the UI when connected */
var addNewPeer = function (connectedPeer) {
    $('#polychrome-events-list').append('<div class="polychrome-event-button" id="polychrome-' + connectedPeer + '-tab">' + connectedPeer + '</div>');
    $('#polychrome-display-list').append('<div class="polychrome-display-button" id="polychrome-' + connectedPeer + '-tab">' + connectedPeer + '</div>');
}

/* handle received event */
function onData(connectedDeviceId, data) {
    var eventType = null;
    var eventName = null;

    for (var name in eventMatchers) {
        if (eventMatchers[name].test(data.eventType)) {
            eventType = data.eventType;
            eventName = name;
            break;
        }
    }

    if (!eventType)
        throw new SyntaxError('Only HTMLEvents and MouseEvents interfaces are supported');

    if (eventType && eventName) {
        var targetName = data.target;
        var posX = data.posX * screenWidth / idealWidth - document.body.scrollLeft;
        var posY = data.posY * screenHeight / idealHeight - document.body.scrollTop;
        var globalX = data.globalX;
        var globalY = data.globalY;
        var targetId = data.targetId;

        executeEventOnPosition(eventType, eventName, posX, posY, targetName, targetId);
        console.log(eventType + "," + deviceId + "," + (new Date().getTime()) + " , " + (data.time));

        addEventFeedback(connectedDeviceId, eventType, parseInt(posX), parseInt(posY));

    } else {
        /* It is not an event but a message*/

    }
}

//on connection 
function connect(conn) {
    conn.on('open', function () {
        connections.push(conn);
        //alert("Now connected to " + conn.peer);
        addNewPeer(conn.peer);
    });

    conn.on('data', function (data) {
        if (data != null)
            onData(conn.peer, data);

    });
}

//var peer = new Peer(deviceId, {
//    host: hostname,
//    port: '8000'
//});

var peer = new Peer(deviceId, {
    host: hostname,
    port: 8000,
    path: '/polychrome',
    key: 'peerjs'
});

peer.on('open', function (id, clientIds) {
    $('#polychrome-id').text("CLIENT ID: " + id);

    //console.log(clientIds);

    if (clientIds) {
        var peer1 = clientIds.split(",");
        peer1.forEach(function (peerid) {
            var conn = peer.connect(peerid);
            conn.on('open', function () {
                connections.push(conn);
                addNewPeer(conn.peer);
            });

            conn.on('data', function (data) {
                if (data != null)
                    onData(conn.peer, data);
            });
        });

    } else {

        peer.listAllPeers(function (clientIds) {
            clientIds.forEach(function (peerid) {
                if (peerid == deviceId) {
                    return;
                }

                var conn = peer.connect(peerid);
                conn.on('open', function () {
                    connections.push(conn);
                    addNewPeer(conn.peer);
                });

                conn.on('data', function (data) {
                    if (data != null)
                        onData(conn.peer, data);
                });
                
            });
        });
    }
});

/* make sure that peerjs connections are handled by the connect function */
peer.on('connection', connect);


/* sockets to connect to server */
var socket = io.connect('http://' + hostname + ":" + port);

/* socket handle incoming messages */
socket.on('MouseEvents', function (data) {
    //console.log('mouse event received');
});


/* on document load */
$(document).ready(function () {

    screenWidth = $(window).width();
    screenHeight = $(window).height();

    //var fb = new FeedbackPanel({});

    var eventHandler = function (evt) {

        var eventId = evt.target.id;
        var elementClass = evt.target.className;

        if (evt.isPolyChrome) {
            return;

        } else if ((eventId.indexOf('polychrome') == -1)) {
            if (evt.type == "mousemove") {
                if (!isMouseDown) {
                    return;
                }
            }

            var toSend = new Object();


            toSend.posX = (evt.pageX) * idealWidth / screenWidth;
            toSend.posY = (evt.pageY) * idealHeight / screenHeight;
            toSend.eventType = evt.type;
            toSend.targetId = globalElement ? globalElement.id : "";

            if (evt.type == "touchmove") {
                toSend.eventType = "mousemove";
                toSend.posX = evt.touches[0].pageX * idealWidth / screenWidth;
                toSend.posY = evt.touches[0].pageY * idealHeight / screenHeight;
            }

            if (evt.type == "touchstart") {
                toSend.eventType = "mousedown";
                toSend.posX = evt.touches[0].pageX * idealWidth / screenWidth;
                toSend.posY = evt.touches[0].pageY * idealHeight / screenHeight;
            }

            if (evt.type == "touchend") {
                toSend.eventType = "mouseup";
                toSend.posX = evt.touches[0] ? evt.touches[0].pageX * idealWidth / screenWidth : 0;
                toSend.posY = evt.touches[0] ? evt.touches[0].pageY * idealHeight / screenHeight : 0;
            }

            if (evt.type == "mousedown") {
                isMouseDown = true;
                $('#pc-event-capturer').css({
                    "display": "none"
                });
                globalElement = document.elementFromPoint(evt.clientX, evt.clientY);
                $('#pc-event-capturer').css({
                    "display": "initial"
                });
                toSend.targetId = globalElement.id;
            }

            if (evt.type == "click") {
                $('#pc-event-capturer').css({
                    "display": "none"
                });
                globalElement = document.elementFromPoint(evt.clientX, evt.clientY);
                $('#pc-event-capturer').css({
                    "display": "initial"
                });
                toSend.targetId = globalElement.id;
            }


            if (evt.type == "mouseup") {
                isMouseDown = false;
                $('#pc-event-capturer').css({
                    "display": "none"
                });
                globalElement = document.elementFromPoint(evt.clientX, evt.clientY);
                $('#pc-event-capturer').css({
                    "display": "initial"
                });
                toSend.targetId = globalElement.id;
            }

            toSend.target = evt.nodeName;
            toSend.globalX = evt.pageX + documentOrigin.x / scaleX;
            toSend.globalY = evt.pageY + documentOrigin.y / scaleY;
            toSend.deviceId = deviceId;
            toSend.time = new Date().getTime();

            // list of elements 
            //var elemList = $.touching({ x: evt.pageX, y: evt.pageY });

            /* send event to other peers */
            if (eventCapture[evt.type]) {

                connections.forEach(function (connection) {
                    connection.send(toSend);
                });

                /* also send the event to server */
                socket.emit('MouseEvents', toSend);

                /* execute the event on current machine */
                onData(deviceId, toSend);
            }

            evt.preventDefault();
            evt.stopPropagation();
            evt.stopImmediatePropagation();

        }
    };

    //fb.attachEvent("mousedown", eventHandler);
    //fb.attachEvent("mousemove", eventHandler);
    //fb.attachEvent("mouseup", eventHandler);

    document.addEventListener("click", eventHandler);
    document.addEventListener("mousedown", eventHandler);
    document.addEventListener("mousemove", eventHandler);
    document.addEventListener("mouseup", eventHandler);
    document.addEventListener("touchstart", eventHandler);
    document.addEventListener("touchmove", eventHandler);
    document.addEventListener("touchend", eventHandler);

    //mousedown mousemove mouseup touchmove touchstart touchend
    var first = false;
    /* toggle to open up PolyChrome feedback */
    $("#polychrome-toggle").click(function () {
        $('#polychrome-toggle').toggleClass('active');
        $("#polychrome-actions").slideToggle("slow");

        if (!first) {
            first = true;
            var items = document.getElementsByTagName("*");
            for (var i = 0; i < items.length; i++) {
                elem = items[i];
                if (elem.id == null || elem.id == "") {
                    elem.id = "pchrome" + i;
                }
            }
        }
    });

    /* change display configuration based on read value */
    if (screenCount == 1) {
        //document.body.style.zoom = 2;
    } else if (screenCount == 2) {
        scaleX = 2;
        scaleY = 1;
        if (screenIndex == 1) {
            $('#chrome_body').css({
                "-webkit-transform": "scale(2, 1)",
                "-webkit-transform-origin": "0% 0%"
            });

        } else {
            $('#chrome_body').css({
                "-webkit-transform": "scale(2, 1)",
                "-webkit-transform-origin": "100% 0%"
            });
        }
    } else if (screenCount == 4) {
        scaleX = 2;
        scaleY = 2;
        if (screenIndex == 1) {
            documentOrigin.x = 0;
            documentOrigin.y = 0;

            $("body").panzoom("zoom", 2, {
                silent: true
            });

        } else if (screenIndex == 2) {
            documentOrigin.x = screenWidth;
            documentOrigin.y = 0;

            $("body").panzoom("zoom", 2, {
                silent: true
            });

            window.scrollTo(screenWidth / 2, 0);

        } else if (screenIndex == 3) {
            documentOrigin.x = 0;
            documentOrigin.y = screenHeight;

            $('#chrome_body').css({
                "-webkit-transform": "scale(2, 2)",
                "-webkit-transform-origin": "0% 100%"
            });
        } else {
            documentOrigin.x = screenWidth;
            documentOrigin.y = screenHeight;

            $('#chrome_body').css({
                "-webkit-transform": "scale(2, 2)",
                "-webkit-transform-origin": "100% 100%"
            });
        }
    }

    /* handle checkbox changes */
    $('#polychrome-checkbox-click').change(function () {
        var $checkbox = $(this);
        if ($checkbox.prop('checked')) {
            eventCapture.click = true;
        } else {
            eventCapture.click = false;
        }
    });

    $('#polychrome-checkbox-mousedown').change(function () {
        var $checkbox = $(this);
        if ($checkbox.prop('checked')) {
            eventCapture.mousedown = true;
        } else {
            eventCapture.mousedown = false;
        }
    });

    $('#polychrome-checkbox-mousemove').change(function () {
        var $checkbox = $(this);
        if ($checkbox.prop('checked')) {
            eventCapture.mousemove = true;
        } else {
            eventCapture.mousemove = false;
        }
    });

    $('#polychrome-checkbox-mouseup').change(function () {
        var $checkbox = $(this);
        if ($checkbox.prop('checked')) {
            eventCapture.mouseup = true;
        } else {
            eventCapture.mouseup = false;
        }
    });

    $('#polychrome-checkbox-touchstart').change(function () {
        var $checkbox = $(this);
        if ($checkbox.prop('checked')) {
            eventCapture.touchstart = true;
        } else {
            eventCapture.touchstart = false;
        }
    });

    $('#polychrome-checkbox-touchmove').change(function () {
        var $checkbox = $(this);
        if ($checkbox.prop('checked')) {
            eventCapture.touchmove = true;
        } else {
            eventCapture.touchmove = false;
        }
    });

    $('#polychrome-checkbox-touchend').change(function () {
        var $checkbox = $(this);
        if ($checkbox.prop('checked')) {
            eventCapture.touchend = true;
        } else {
            eventCapture.touchend = false;
        }
    });


    $(window).on("load", function () {

        var items = document.getElementsByTagName("*");
        for (var i = 0; i < items.length; i++) {
            elem = items[i];
            if (elem.id == null || elem.id == "") {
                elem.id = "pchrome" + i;
            }
        }
    });
});