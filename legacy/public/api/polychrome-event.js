
/* event types */
var eventMatchers = {
    'HTMLEvents': /^(?:load|unload|abort|error|select|change|submit|reset|focus|blur|resize|scroll)$/,
    'MouseEvents': /^(?:click|dblclick|mouse(?:down|up|over|move|out))$/
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

function PolyChromeEvent(options) {

    var _self = this;

    if (options.isNative == null) {
        /* raise error */
    }

    _self.isNative = options.isNative;

    if (options.isNative) {
        //_self.nativeEvent = options.nativeEvent;
        _self.pageWidth = options.pageWidth;
        _self.pageHeight = options.pageHeight;
        _self.eventType = options.eventType;
        _self.deviceId = options.deviceId;
        _self.posX = options.posX;
        _self.posY = options.posY;
        _self.element = options.element;
        _self.time = options.time;

        /* check if eventType is known type */
        var eventName = _self.checkEvent(_self.eventType);

        if (eventName == null) {
            /* raise error */
        }

        if (eventName && eventName.name) {
            _self.eventName = eventName.name;
        } else {
            _self.eventName = "MouseEvents";
        }
    }


    /* if custom event */
    if (options.isNative == false) {
        _self.eventType = options.eventType;
        _self.deviceId = options.deviceId;    
        _self.content = options.content;
    }

}

PolyChromeEvent.prototype.checkEvent = function (eventType) {

    var _self = this;
    for (var name in eventMatchers) {
        if (eventMatchers[name].test(eventType)) {
            return { "name": name };
        }
    }

    return null;
}

PolyChromeEvent.prototype.shareEvent = function () {
    var _self = this;
    var toSend = _self.getPacket();
    PeerConnection.send(toSend);
}

PolyChromeEvent.prototype.getPacket = function () {
    var _self = this;
    var toSend = new Object();

    if (_self.isNative) {
        toSend.posX = (_self.posX) * idealWidth / screenWidth;
        toSend.posY = (_self.posY) * idealHeight / screenHeight;
        toSend.eventType = _self.eventType;
        toSend.targetId = _self.element.id;
        toSend.target = _self.nodeName;
        toSend.deviceId = _self.deviceId;
        toSend.time = _self.time;

    } else {
        toSend.content = _self.content;
        toSend.eventType = _self.eventType;
        toSend.isNative = _self.isNative;
        toSend.deviceId = _self.deviceId;

    }
    return toSend;
}

PolyChromeEvent.prototype.shareEventToSelected = function () {
    var _self = this;

}

PolyChromeEvent.prototype.shareWithServer = function () {
    var _self = this;

}

/* A custom event -- can be a combination of native events or a totally new sort of event */
PolyChromeEvent.prototype.CustomEventBehavior = function (Handler) {
    var _self = this;
    Handler(_self.customContent);
}


function extend(destination, source) {
    for (var property in source)
        destination[property] = source[property];
    return destination;
}


PolyChromeEvent.prototype.execute = function () {
    var _self = this;

    if (_self.isNative) {
        var oEvent = null;

        var options = new Object();
        options = extend(options, defaultOptions);

        if (_self.eventName == "MouseEvents") {

            if (document.createEvent) {
                console.log(_self.eventType + "," + (new Date().getTime() - _self.time));
            
                oEvent = document.createEvent("MouseEvents");

                /* recognize that this is PolyChrome event */
                oEvent.isPolyChrome = true;
                oEvent.deviceId = _self.deviceId;

                var px = _self.posX - DisplayConfiguration.xTranslate;
                var py = _self.posY - DisplayConfiguration.yTranslate;

                oEvent.initMouseEvent(_self.eventType, options.bubbles, options.cancelable, document.defaultView,
            1, px, py, px, py, options.ctrlKey, options.altKey, options.shiftKey, options.metaKey,
            options.button, _self.element);
                if (_self.element && oEvent)
                    _self.element.dispatchEvent(oEvent);

            } else {

                options.clientX = _self.posX;
                options.clientY = _self.posY;
                var evt = document.createEventObject();
                evt.isPolyChrome = true;
                evt.deviceId = _self.deviceId;

                oEvent = extend(evt, options);
                element.fireEvent('on' + _self.eventType, oEvent);
            }

            FeedbackPanel.addEventFeedback(_self.deviceId, _self.eventType, parseInt(_self.posX), parseInt(_self.posY));

        } else if (_self.eventName == "HTMLEvents") {

            if (document.createEvent) {
                oEvent = document.createEvent("HTMLEvents");
                oEvent.isPolyChrome = true;
                oEvent.deviceId = _self.deviceId;

                oEvent.initEvent(_self.eventType, options.bubbles, options.cancelable);
                element.dispatchEvent(oEvent);

            } else {

                options.clientX = options.pointerX;
                options.clientY = options.pointerY;
                var evt = document.createEventObject();
                evt.isPolyChrome = true;
                evt.deviceId = _self.deviceId;

                oEvent = extend(evt, options);
                element.fireEvent('on' + _self.eventType, oEvent);
            }

        }
    } else {

        PolyChromeEventHandler.customHandler(_self.content);
    }
}
