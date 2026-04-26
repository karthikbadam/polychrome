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

/* define event capture states */
var eventCapture = {};
eventCapture.click = true;
eventCapture.touchstart = true;
eventCapture.touchmove = true;
eventCapture.touchend = true;
eventCapture.mousedown = true;
eventCapture.mousemove = true;
eventCapture.mouseup = true;

var pcrandom = {
    normal: function (mu, sigma) {
        var n = arguments.length;
        if (n < 2) sigma = 1;
        if (n < 1) mu = 0;
        return function () {
            var x, y, r;
            do {
                /* should synchronize this value!! for pseudo random */
                x = Math.random() * 2 - 1;
                y = Math.random() * 2 - 1;
                r = x * x + y * y;
            } while (!r || r > 1);
            return mu + sigma * x * Math.sqrt(-2 * Math.log(r) / r);
        };
    },
    logNormal: function () {
        var random = d3.random.normal.apply(d3, arguments);
        return function () {
            return Math.exp(random());
        };
    },
    bates: function (m) {
        var random = d3.random.irwinHall(m);
        return function () {
            return random() / m;
        };
    },
    irwinHall: function (m) {
        return function () {
            for (var s = 0, j = 0; j < m; j++) s += Math.random();
            return s;
        };
    }
};

var FeedbackPanel = {

    init: function () {
        $('#polychrome-display-dump').css({
            'background-color': 'rgba(100, 100, 100, 1)'
        });
        $('#polychrome-display-dump').css('background-image', 'none');
    },

    setDisplayBackground: function () {

        $('#polychrome-display-dump').empty();

        html2canvas(document.body, {
            onrendered: function (canvas) {
                var ctx = canvas.getContext('2d'),
                    rect = {},
                    drag = false;

                var width = 200;
                var height = 100;
                $(canvas).attr("width", width);
                $(canvas).attr("height", height);
                $(canvas).css("background-color", "#FFF");

                ctx.strokeStyle = "rgba(255 , 0, 0, 0.2)";
                ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
                ctx.lineWidth = '5';

                $('#polychrome-display-dump').append(canvas);

                canvas.addEventListener('mousedown', mouseDown, false);
                canvas.addEventListener('mouseup', mouseUp, false);
                canvas.addEventListener('mousemove', mouseMove, false);

                function getMousePos(canvas, evt) {
                    var rect1 = canvas.getBoundingClientRect();
                    return {
                        x: evt.clientX - rect1.left,
                        y: evt.clientY - rect1.top
                    };
                }

                function mouseDown(e) {
                    var mousePos = getMousePos(canvas, e);
                    rect.startX = mousePos.x;
                    rect.startY = mousePos.y;
                    drag = true;
                }

                function mouseUp() {

                    drag = false;
                }

                function mouseMove(e) {
                    var mousePos = getMousePos(canvas, e);
                    if (drag) {
                        rect.w = (mousePos.x - rect.startX);
                        rect.h = (mousePos.y - rect.startY);
                        ctx.clearRect(0, 0, canvas.width, canvas.height);
                        ctx.fillRect(rect.startX, rect.startY, rect.w, rect.h);
                    }
                }
            },
            allowTaint: true
        });


    },

    /* Method for adding event details to UI */
    addNewPeer: function (connectedPeer) {
        $('#polychrome-events-list').append('<div class="polychrome-event-button" id="polychrome-' + connectedPeer + '-tab">' + connectedPeer + '</div>');
        $('#polychrome-display-list').append('<div class="polychrome-display-button" id="polychrome-' + connectedPeer + '-tab">' + connectedPeer + '</div>');
    },

    /* Method to add new peer details to the UI when connected */
    addEventFeedback: function (connectedClientId, eventType, posX, posY) {
        $('#polychrome-events-dump').prepend('<div class="polychrome-event-element">' + eventType + ' for ' + connectedClientId + ' at ' + posX + ", " + posY + ' </div>');
    }
}

/* Link to the server */
var ServerConnection = {
    socket: null,
    url: null,

    init: function (url) {

        var _self = this;
        _self.url = url;
        _self.socket = io.connect('http://' + hostname + ":" + port);

        _self.socket.on('MouseEvent', function (data) {

        });

        _self.socket.on('MouseEvents', function (events) {
            _self.replayEvents(events);
            events.splice(events.length - 1, 1);

        });
    },

    send: function (event) {
        var _self = this;
        var toSend = event.getPacket();
        toSend['url'] = _self.url;
        _self.socket.emit('MouseEvents', toSend);
    },

    get: function () {
        var _self = this;
        var toSend = new Object();
        toSend.url = _self.url;
        _self.socket.emit('getMouseEvents', toSend);
    },

    replayEvents: function (events) {
        console.log("got events " + events.length);
        for (var i = 0; i < events.length; i++) {
            var data = events[i];
            var posX = data.posX * screenWidth / idealWidth;
            var posY = data.posY * screenHeight / idealHeight;
            var targetId = data.targetId;
            var targetName = data.target;
            var element = document.getElementById(targetId);
            var eventType = data.eventType;

            var event = new PolyChromeEvent({
                deviceId: data.deviceId,
                posX: posX,
                posY: posY,
                eventType: eventType,
                element: element,
                pageWidth: screenWidth,
                pageHeight: screenHeight,
                name: "MouseEvents",
                isNative: true
            });

            event.execute();
        }
    },

    replayEvent: function (event) {

    }

}


/* Link to other clients */
var PeerConnection = {
    peer: null,
    connections: [],

    init: function () {
        var _self = this;

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

//        _self.peer = new Peer(deviceId, {
//            host: hostname,
//            port: '8000'
//        });

        _self.peer = new Peer(deviceId, {
            host: hostname,
            port: 8000,
            path: '/polychrome',
            key: 'peerjs'
        });

        _self.peer.on('open', function (id, clientIds) {
            $('#polychrome-id').text("CLIENT ID: " + id);

            //console.log(clientIds);

            if (clientIds) {
                var peer1 = clientIds.split(",");
                peer1.forEach(function (peerid) {
                    var conn = _self.peer.connect(peerid);
                    conn.on('open', function () {
                        _self.connections.push(conn);
                        FeedbackPanel.addNewPeer(conn.peer);
                    });

                    conn.on('data', function (data) {
                        if (data != null)
                            _self.onData(conn.peer, data);
                    });
                });

            } else {

                _self.peer.listAllPeers(function (clientIds) {
                    clientIds.forEach(function (peerid) {
                        if (peerid == deviceId) {
                            return;
                        }

                        var conn = _self.peer.connect(peerid);
                        conn.on('open', function () {
                            _self.connections.push(conn);
                            FeedbackPanel.addNewPeer(conn.peer);
                        });

                        conn.on('data', function (data) {
                            if (data != null)
                                _self.onData(conn.peer, data);
                        });

                    });
                });
            }
        });

        /* make sure that peerjs connections are handled by the connect function */
        _self.peer.on('connection', connect);

        /* on connection */
        function connect(conn) {
            conn.on('open', function () {
                _self.connections.push(conn);
                FeedbackPanel.addNewPeer(conn.peer);
                console.log("connected to " + conn.peer);
                //alert("Connected to -" + conn.peer);
            });

            conn.on('data', function (data) {
                if (data != null)
                    _self.onData(conn.peer, data);
            });
        }
    },

    send: function (toSend) {
        var _self = this;

        _self.connections.forEach(function (connection) {
            if (connection)
                connection.send(toSend);
        });
    },

    onData: function (connectedDeviceId, data) {
        var eventType = data.eventType;
        var eventName = null;

        for (var name in eventMatchers) {
            if (eventMatchers[name].test(data.eventType)) {
                eventType = data.eventType;
                eventName = name;
                break;
            }
        }

        //if (!eventType)
        //    throw new SyntaxError('Only HTMLEvents and MouseEvents interfaces are supported');

        if (eventType && eventName) {
            var posX = data.posX * screenWidth / idealWidth;
            var posY = data.posY * screenHeight / idealHeight;
            var targetId = data.targetId;
            var targetName = data.target;
            var element = document.getElementById(targetId);

            var event = new PolyChromeEvent({
                deviceId: connectedDeviceId,
                posX: posX,
                posY: posY,
                eventType: eventType,
                element: element,
                pageWidth: screenWidth,
                pageHeight: screenHeight,
                time: data.time,
                isNative: true
            });

            event.execute();

        } else if (eventType) {

            /* custom event */
            var event = new PolyChromeEvent({
                deviceId: connectedDeviceId,
                content: data.content,
                eventType: data.eventType,
                isNative: data.isNative
            });

            event.execute();
        }
    }
}

var PolyChromeEventHandler = {
    event: null,
    customHandler: null,

    init: function () {

    },

    polyChromify: function () {
        /* get screen width and height */
        screenWidth = $(window).width();
        screenHeight = $(window).height();

        /* toggle to open up PolyChrome feedback */
        $("#polychrome-toggle").click(function () {
            $('#polychrome-toggle').toggleClass('active');
            $("#polychrome-actions").slideToggle("slow");
        });

        $(document).keyup(function (e) {
            //escape
            if (e.keyCode == 27) {
                $('#polychrome-toggle').toggleClass('active');
                $("#polychrome-actions").slideToggle("slow");
            }
        });


        /* assign unique ids to each dom element -- for retrieval */
        var items = document.getElementsByTagName("*");
        for (var i = 0; i < items.length; i++) {
            elem = items[i];
            if (elem.id == null || elem.id == "") {
                elem.id = "pchrome" + i;
            }
        }
    },

    wrapEvent: function (eventType, posX, posY, element, nativeEvent) {

        var _self = this;

        _self.event = new PolyChromeEvent({
            deviceId: deviceId,
            posX: (posX + DisplayConfiguration.xTranslate) / DisplayConfiguration.hScaling,
            posY: (posY + DisplayConfiguration.yTranslate) / DisplayConfiguration.vScaling,
            eventType: eventType,
            element: element,
            nativeEvent: nativeEvent,
            pageWidth: screenWidth,
            pageHeight: screenHeight,
            isNative: true,
            time: new Date().getTime()
        });
    },

    shareEvent: function () {
        var _self = this;
        _self.event.shareEvent();
        _self.event.execute();
        ServerConnection.send(_self.event);

    },

    createCustomEvent: function (eventType, content) {
        var _self = this;
        _self.event = new PolyChromeEvent({
            deviceId: deviceId,
            content: content,
            eventType: eventType,
            isNative: false
        });
    },

    setCustomEventHandler: function (Handler) {
        var _self = this;
        _self.customHandler = Handler;
    }

}

/* 
 *  Leader -> share all events - receive no events,
 *  Lagger -> share no events - receive all events,
 *  implicit -> share and receive all events,
 *  explicit -> pile events on the client and wait for an explicit register
 */

var SHARING = {
    LEADER: 0,
    LAGGER: 1,
    IMPLICIT: 2,
    EXPLICIT: 3
}

var DISPLAY = {
    MIRROR: 0,
    SPLIT: 1
}

/* Display modules */
var DisplayConfiguration = {
    DisplayType: 0,
    screenType: 0,
    sharingType: 2,
    numberOfScreens: [1, 1],
    hScaling: 1,
    vScaling: 1,
    screen: 0,
    xTranslate: 0,
    yTranslate: 0,
    TAG: "TABLET",

    init: function (space, screen, sharing, numberOfScreens) {
        var _self = this;

        if (space) {
            _self.spaceType = DISPLAY[space];
        }

        if (sharing) {
            _self.sharingType = SHARING[sharing];
        }

        if (screen) {
            _self.screen = screen;
        }

        if (numberOfScreens) {
            _self.numberOfScreens = numberOfScreens;
        }

        /* prepare the background in the display configuration panel */


        /* change css in case of split */
        if (_self.spaceType == 1) {

            /* scaling */
            _self.hScaling = _self.numberOfScreens[0];
            _self.vScaling = _self.numberOfScreens[1];

            /* translation */
            _self.xTranslate = (Math.floor(_self.screen % _self.hScaling)) * screenWidth;
            _self.yTranslate = (Math.floor(_self.screen / _self.hScaling)) * screenHeight;
            $('html').css({
                '-webkit-transform-origin': (_self.xTranslate) + "px " + (_self.yTranslate) + "px"
            });
            $('html').css({
                '-webkit-transform': "scale(" + _self.hScaling + "," + _self.vScaling + ")"
            });

            _self.TAG = "PIVOTWALL";

        } else {
            _self.numberOfScreens = [1, 1];
            _self.hScaling = 1;
            _self.vScaling = 1;
            _self.screen = 0;
            _self.xTranslate = 0;
            _self.yTranslate = 0;
            /* scaling */
            _self.hScaling = _self.numberOfScreens[0];
            _self.vScaling = _self.numberOfScreens[1];

            /* translation */
            $('html').css({
                '-webkit-transform-origin': (_self.xTranslate) + "px " + (_self.yTranslate) + "px"
            });
            $('html').css({
                '-webkit-transform': "scale(" + _self.hScaling + "," + _self.vScaling + ")"
            });

            _self.TAG = "TABLET";
        }
    }

}


$(document).ready(function () {
    /* selection handlers - need a better place */
    //Clone 
    $("#one-screen").click(function () {
        numberOfScreens = [1, 1];
        DisplayConfiguration.init('MIRROR', 0, 'IMPLICIT', numberOfScreens);
    });

    //four screen left top
    $("#four-screen-left-top").click(function () {
        numberOfScreens = [2, 2];
        DisplayConfiguration.init('SPLIT', 0, 'IMPLICIT', numberOfScreens);
    });

    //four screen right top
    $("#four-screen-right-top").click(function () {
        numberOfScreens = [2, 2];
        DisplayConfiguration.init('SPLIT', 1, 'IMPLICIT', numberOfScreens);
    });

    //four screen left bottom
    $("#four-screen-left-bottom").click(function () {
        numberOfScreens = [2, 2];
        DisplayConfiguration.init('SPLIT', 2, 'IMPLICIT', numberOfScreens);
    });

    //four screen right bottom
    $("#four-screen-right-bottom").click(function () {
        numberOfScreens = [2, 2];
        DisplayConfiguration.init('SPLIT', 3, 'IMPLICIT', numberOfScreens);
    });
});