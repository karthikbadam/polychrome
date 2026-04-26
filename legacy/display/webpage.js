
/**
* Definition class for any webpage   
**/
var http = require('http');
var url = require('url');

function WebPage(options) {
    var _self = this;
    _self.url = options.url;
    _self.spaceConfig = options.spaceConfig;
    _self.displayConfig = options.displayConfig;
    _self.isValid = true;
    _self.isCached = false;
    _self.currentBaseUrl = _self.url; 
}

WebPage.prototype.getUrl = function () {
    var _self = this;
    return _self.url;
};

WebPage.prototype.setCurrentBaseUrl = function (url) {
    var _self = this;
    _self.currentBaseUrl = url;
};

WebPage.prototype.getCurrentBaseUrl = function (url) {
    var _self = this;
   return _self.currentBaseUrl;
};

WebPage.prototype.parseUrl = function () {
    var _self = this;

    _self.urlObject = url.parse(_self.url, true);

    if (!_self.urlObject.protocol) {
        _self.urlObject.protocol = "http:";
    }

    if (_self.urlObject.hostname) {

        var port = 80;
        if (_self.urlObject.port) {
            port = _self.urlObject.port;
        }

        http.get({
            host: _self.urlObject.hostname,
            port: port
        }, function (res) {
            //console.log("success " + res);
            _self.isValid = true;
        }).on("error", function (e) {
            _self.isValid = false;
            throw new Error('invalid URL');
        });

    } else {
        _self.isValid = false;
        throw new Error('invalid URL');
    }

    return url.format(_self.urlObject);
};

WebPage.prototype.getbaseUrl = function () {
    var _self = this;
    var url = _self.parseUrl();
    var path = _self.urlObject.pathname;
    var returnString = url.replace("/" + _self.urlObject.pathname, '');
    returnString = url.replace(_self.urlObject.pathname, '');
    return returnString;
};

/* set the content for the page - caching! */
WebPage.prototype.setContent = function (body) {
    var _self = this;
    _self.body = body;
    _self.isCached = true;
};

/* get the content after caching */
WebPage.prototype.getContent = function () {
    var _self = this;
    if (_self.isCached) {
        return _self.body;
    }
    return;
};

/* append relative path */
WebPage.prototype.appendPath = function (path, callback) {
    var _self = this;

    var baseUrl = _self.getbaseUrl();
    var url = _self.getUrl();
    var hostpath = baseUrl + path;

    if (url.charAt(url.length - 1) === '/' && path.charAt(0) === '/') {
        path = path.substr(1);
        hostpath = url + path;
    }

    checkUrl(hostpath, checkBaseUrl);

    var checkBaseUrl = function () {
        baseUrl = _self.getbaseUrl();
        hostpath = baseUrl + path;

        if (baseUrl.charAt(baseUrl.length - 1) === '/' && path.charAt(0) === '/') {
            path = path.substr(1);
            hostpath = url + path;
        }

        checkUrl(hostpath, null);
    }

    var checkUrl = function (hostname, checkBaseUrl) {
        http.get({
            host: hostname,
            port: 80
        }, function (res) {
            _self.isValid = true;
            return callback(hostname);
        }).on("error", function (e) {
            if (checkBaseUrl)
                return checkBaseUrl();
            console.log("Check path " + path);
        });
    }
}

exports.WebPage = WebPage;

