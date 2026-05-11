
var express = require('express');
var routes = require('./routes');
var user = require('./routes/user');
var http = require('http');
var path = require('path');
var fs = require('fs');
var connect = require('connect');
var jsdom = require('jsdom');
var request = require('request');
var url = require('url');
var cheerio = require('cheerio');
var mime = require('mime');
var querystring = require('querystring');
var webshot = require('webshot');

/* TODO: should find this automatically */
var hostname = 'localhost:3000';

var screenshot_options = {
    screenSize: {
        width: 1280,
        height: 800
    },
    shotSize: {
        width: 1280,
        height: 800
    }
}

/* cache file for all html files */
var cache = {};

/* display web page class */
var pageclass = require('./display/webpage');
var WebPage = pageclass.WebPage;
var currentPage = null;

/* session control */
var sessionclass = require('./display/polychrome-session');
var PolyChromeSession = sessionclass.PolyChromeSession;
var sessions = {};
var peerIds = [];

/* peer server to give unique id to each peer */
//var peer = require('./peer/server');
//var PeerServer = peer.PeerServer;
var PeerServer = require('peer').PeerServer;

var app = express();
app.engine('.html', require('ejs').__express);

// all environments
app.set('port', process.env.PORT || 3000);
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'html');
app.use(express.favicon());
app.use(express.logger('dev'));
app.use(express.json());
app.use(express.urlencoded());
app.use(express.methodOverride());
app.use(express.cookieParser('your secret here'));
app.use(express.session());
app.use(require('stylus').middleware(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.bodyParser());
app.use(app.router);

// development only
if ('development' == app.get('env')) {
    app.use(express.errorHandler());
}

/* opening page */
app.get('/', routes.index);

/* app1 drawing */
app.get('/drawing', routes.drawing);

/* app2 choropleth */
app.get('/choropleth', routes.choropleth);

/* app3 scatterplot */
app.get('/scatterplot', routes.scatterplot);

/* app4 iris */
app.get('/iris', routes.iris);

/* app5 map */
app.get('/map', routes.map);


/* app5 PolyChrome */
app.get('/preso', routes.preso);


/* requests for data */
app.get('/data/*', function (req, res) {
    console.log("data request captured: " + req.url);
    var urlString = currentPage.url + req.url;
    if (req.url.charAt(0) === '/') {
        var baseUrl = currentPage.getCurrentBaseUrl();
        urlString = baseUrl + req.url;
        if (baseUrl.charAt(baseUrl.length - 1) === '/') {
            urlString = baseUrl + req.url.substr(1);
        }
    }
    request({
        uri: urlString
    }, function (err, response, body) {
        if (err) {
            res.writeHead(400);
        } else {
            res.writeHead(200);
        }
        res.write(response.body);
        res.end();
    });
});

/* image requests captured */
app.get('/images/*', function (req, res) {
    console.log("image request captured: " + req.url);
    if (req.url.indexOf("polychrome-cache.png") >= 0) {
        var filename = "cache/polychrome-cache.png";
        if (fs.existsSync(filename)) {
            fs.readFile(filename, function (err, data) {
                if (err) throw err; // Fail if the file can't be read.
                res.writeHead(200, { 'Content-Type': 'image/png' });
                res.end(data); // Send the file data to the browser.
                return;
            });
        }
    } else {


        var urlString = currentPage.url + req.url;
        if (req.url.charAt(0) === '/') {
            var baseUrl = currentPage.getCurrentBaseUrl();
            urlString = baseUrl + req.url;
            if (baseUrl.charAt(baseUrl.length - 1) === '/') {
                urlString = baseUrl + req.url.substr(1);
            }
        }

        /* download and cache image in file system */
        var filename = "cache/" + url.parse(urlString).pathname.split("/").pop();
        if (fs.existsSync(filename)) {
            fs.readFile(filename, function (err, data) {
                if (err) throw err; // Fail if the file can't be read.
                res.writeHead(200, { 'Content-Type': 'image/png' });
                res.end(data); // Send the file data to the browser.
            });

        } else {
            var download = function (uri, filename, callback) {
                request.head(uri, function (err, res, body) {
                    console.log('content-type:', res.headers['content-type']);
                    console.log('content-length:', res.headers['content-length']);

                    request(uri).pipe(fs.createWriteStream(filename)).on('close', callback);
                });
            };

            download(urlString, filename, function () {
                fs.readFile(filename, function (err, data) {
                    if (err) throw err; // Fail if the file can't be read.
                    res.writeHead(200, { 'Content-Type': 'image/png' });
                    res.end(data); // Send the file data to the browser.
                });
            });
        }
    }

});

app.get('/img/*', function (req, res) {
    console.log("image request captured: " + req.url);
    var urlString = currentPage.url + req.url;
    if (req.url.charAt(0) === '/') {
        var baseUrl = currentPage.getCurrentBaseUrl();
        urlString = baseUrl + req.url;
        if (baseUrl.charAt(baseUrl.length - 1) === '/') {
            urlString = baseUrl + req.url.substr(1);
        }
    }

    /* download and cache image in file system */
    var filename = "cache/" + url.parse(urlString).pathname.split("/").pop();
    if (fs.existsSync(filename)) {
        fs.readFile(filename, function (err, data) {
            if (err) throw err; // Fail if the file can't be read.
            res.writeHead(200, { 'Content-Type': 'image/png' });
            res.end(data); // Send the file data to the browser.
        });

    } else {
        var download = function (uri, filename, callback) {
            request.head(uri, function (err, res, body) {
                console.log('content-type:', res.headers['content-type']);
                console.log('content-length:', res.headers['content-length']);

                request(uri).pipe(fs.createWriteStream(filename)).on('close', callback);
            });
        };

        download(urlString, filename, function () {
            fs.readFile(filename, function (err, data) {
                if (err) throw err; // Fail if the file can't be read.
                res.writeHead(200, { 'Content-Type': 'image/png' });
                res.end(data); // Send the file data to the browser.
            });
        });
    }

    //request({
    //    uri: urlString
    //}, function (err, response, body) {
    //    if (err) {
    //        res.writeHead(400);
    //        return;
    //    } else {
    //        console.log(filename);
    //        res.contentType(filename);
    //        //res.writeHead(200, { "Content-Type": 'image/png', 'Content-Length': body.size }); // Pass in the mime-type
    //        res.send(body); //Stream the file down
    //        res.end();
    //    }
    //});

});

/* js files requested by the webpage */
//app.get('/js/*', function (req, res) {

//    console.log("JS request captured: " + req.url);
//    var urlString = currentPage.url + req.url;
//    if (req.url.charAt(0) === '/') {
//        var baseUrl = currentPage.getCurrentBaseUrl();
//        urlString = baseUrl + req.url;
//        if (baseUrl.charAt(baseUrl.length - 1) === '/') {
//            urlString = baseUrl + req.url.substr(1);
//        }
//    }
//    request({
//        uri: urlString
//    }, function (err, response, body) {
//        if (err) {
//            res.writeHead(400);
//        } else {
//            res.writeHead(200);
//        }
//        res.write(response.body);
//        res.end();
//    });

//});

/* load url from login page */
app.post('/loadUrl', function (req, res) {

    hostname = req.headers.host;
    var arrayOfStrings = hostname.split(":");
    var host = arrayOfStrings[0];
    var port = '3000';
    if (arrayOfStrings.length >= 2) {
        port = arrayOfStrings[1];
    }

    var selectedUrl = String(req.body.url);
    var spaceConfiguration = parseInt(req.body.space);
    var displayConfiguration = parseInt(req.body.display);
    var peerId = String(req.body.peerId);

    var page = new WebPage({
        url: selectedUrl,
        spaceConfig: spaceConfiguration,
        displayConfig: displayConfiguration,
        peerId: peerId
    });

    page.parseUrl();
    currentPage = page;

    var session = new PolyChromeSession({
        page: page,
        peerId: peerId,
        username: "chrome",
        password: "chrome"
    });

    sessions[peerId] = session;
    peerIds.push(peerId);

    var urlEncoding = { 'url': selectedUrl, 'peerId': peerId, 'spaceConfig': spaceConfiguration, 'displayConfig': displayConfiguration, 'host': host, 'port': port };
    var toOpen = 'http://' + hostname + '/polychrome?' + querystring.stringify(urlEncoding);

    res.write(toOpen);
    res.end();
});

app.get('/polychrome', function (req, res) {

    hostname = req.headers.host;
    var parsedUrl = url.parse(req.url, true); // true to get query as object
    var params = parsedUrl.query;
    var selectedUrl = "";

    var peerId = "";
    var spaceConfiguration = 1;
    var displayConfiguration = 1;

    if (JSON.stringify(params) !== '{}') {
        selectedUrl = String(params.url);
        peerId = String(params.peerId);
        spaceConfiguration = parseInt(params.screenConfig);
        displayConfiguration = parseInt(params.displayConfig);
    }

    var page = new WebPage({
        url: selectedUrl,
        spaceConfig: spaceConfiguration,
        displayConfig: displayConfiguration
    });

    page.parseUrl();
    currentPage = page;

    var currentPageCache = cache[page.parseUrl()];
    if (currentPageCache) {

        console.log('Served from Cache ' + page.parseUrl());
        res.write(currentPageCache);
        res.end();

    } else {

        /* capture a screenshot using node-webshot */
        webshot(selectedUrl, 'cache/polychrome-cache.png', screenshot_options, function (err) {
            if (err)
                console.log(err);
        });

        //Tell the request that we want to fetch youtube.com, send the results to a callback function
        request({ uri: selectedUrl }, function (err, response, body1) {
            var isBlocked = 'No';

            // If the page was found...
            if (!err && response.statusCode == 200) {
                // Grab the headers
                var headers = response.headers;

                // Grab the x-frame-options header if it exists
                var xFrameOptions = headers['x-frame-options'] || '';

                // Normalize the header to lowercase
                xFrameOptions = xFrameOptions.toLowerCase();

                // Check if it's set to a blocking option
                if (
					xFrameOptions === 'sameorigin' ||
					xFrameOptions === 'deny'
					) {
                    isBlocked = 'Yes';
                }

            } else {

                res.end("Page NOT FOUND");
            }

            //Just a basic error check
            if (err && response.statusCode !== 200) {
                console.log('Request error');
            }

            body1 = response.body;

            jsdom.env({
                html: body1,
                scripts: ['http://code.jquery.com/jquery-2.1.0.js', 'http://' + hostname + '/javascripts/jquery.panzoom.js', 'http://' + hostname + '/javascripts/html2canvas.js', 'http://' + hostname + '/javascripts/jquery.nearest.js', 'http://' + hostname + '/javascripts/polychrome-peer.js', 'http://' + hostname + '/socket.io/socket.io.js', 'http://' + hostname + '/javascripts/polychrome-feedback-panel.js', 'http://' + hostname + '/javascripts/polychrome-feedback-svg.js'],
                done: function (err, window) {

                    var $ = window.jQuery;

                    $('script').each(function () {
                        var link = $(this).attr('src');
                        if (link !== undefined && link.indexOf("http") == -1) {
                            var url = selectedUrl + link;
                            if (link.charAt(0) === '/') {
                                var baseUrl = page.getbaseUrl();
                                page.setCurrentBaseUrl(baseUrl);
                                url = baseUrl + link;
                                if (baseUrl.charAt(baseUrl.length - 1) === '/') {
                                    url = baseUrl + link.substr(1);
                                }
                            } else {
                                if (selectedUrl.charAt(selectedUrl.length - 1) !== '/') {
                                    url = selectedUrl + "/" + link;
                                }
                            }
                            console.log(url);
                            $(this).attr('src', url);
                        }
                    });

                    $('link').each(function () {
                        var css = $(this).attr('href');
                        if (css.indexOf(".com") == -1) {
                            var url = selectedUrl + css;
                            if (css.charAt(0) === '/') {
                                var baseUrl = page.getbaseUrl();
                                currentPage.setCurrentBaseUrl(baseUrl);
                                url = baseUrl + css;
                                if (baseUrl.charAt(baseUrl.length - 1) === '/') {
                                    url = baseUrl + css.substr(1);
                                }
                            } else {
                                if (selectedUrl.charAt(selectedUrl.length - 1) !== '/') {
                                    url = selectedUrl + "/" + css;
                                }
                            }
                            console.log(url);
                            $(this).attr('href', url);
                        }
                    });

                    $('image').each(function () {
                        var image = $(this).attr('href');
                        if (image !== undefined && image.indexOf(".com") == -1) {
                            var url = selectedUrl + image;
                            if (image.charAt(0) === '/') {
                                var baseUrl = page.getbaseUrl();
                                currentPage.setCurrentBaseUrl(baseUrl);
                                url = baseUrl + image;
                                if (baseUrl.charAt(baseUrl.length - 1) === '/') {
                                    url = baseUrl + image.substr(1);
                                }
                            } else {
                                if (selectedUrl.charAt(selectedUrl.length - 1) !== '/') {
                                    url = selectedUrl + "/" + image;
                                }
                            }
                            console.log(url);
                            $(this).attr('href', url);
                        }
                    });

                    $('a').each(function () {
                        var hyperlink = $(this).attr('href');
                        if (hyperlink !== undefined && hyperlink.indexOf("http") == -1) {
                            var url = selectedUrl + hyperlink;
                            if (hyperlink.charAt(0) === '/') {
                                var baseUrl = page.getbaseUrl();
                                currentPage.setCurrentBaseUrl(baseUrl);
                                url = baseUrl + hyperlink;
                                if (baseUrl.charAt(baseUrl.length - 1) === '/') {
                                    url = baseUrl + hyperlink.substr(1);
                                }
                            } else {
                                if (selectedUrl.charAt(selectedUrl.length - 1) !== '/') {
                                    url = selectedUrl + "/" + hyperlink;
                                }
                            }
                            console.log(url);

                            var urlEncoding = { 'url': url, 'peerId': peerId, 'spaceConfig': spaceConfiguration, 'displayConfig': displayConfiguration };
                            var toOpen = 'http://' + hostname + '/polychrome?' + querystring.stringify(urlEncoding);


                            $(this).attr('href', toOpen);
                        }
                    });

                    $('body').prepend('<link rel="stylesheet" href="stylesheets/polychrome-style.css"></link>');
                    $('head').prepend('<link rel="shortcut icon" href="images/polychrome-icon.png" />');
                    $('body').attr('id', 'chrome_body');

                    var polychrome_panel = fs.readFileSync("public/renderings/polychrome-feedback.html", 'utf8');
                    $('body').append(polychrome_panel.toString());
                    //$('body').append('<script>var peerId = "' + peerId + '"; </script>');

                    /* caching the page */
                    cache[page.parseUrl()] = '<html>' + $('html').html() + '</html>';

                    res.write('<html>' + $('html').html() + '</html>');
                    res.end();

                }
            });
        });
    }
});

/* wild card for any other requests */
app.get('/*', function (req, res) {

    if (currentPage && req.url.indexOf("polychrome") === -1) {
        console.log("request captured by wildcard: " + req.url);
        var urlString = currentPage.url + req.url;
        if (req.url.charAt(0) === '/') {
            var baseUrl = currentPage.getCurrentBaseUrl();
            urlString = baseUrl + req.url;
            if (baseUrl.charAt(baseUrl.length - 1) === '/') {
                urlString = baseUrl + req.url.substr(1);
            }
        }

        console.log("Wild card url - " + urlString);


        var currentPageCache = cache[urlString];
        if (currentPageCache) {

            console.log('Served from Cache ' + urlString);
            res.write(currentPageCache);
            res.end();

        } else {
            request({
                uri: urlString
            }, function (err, response, body) {
                if (err) {
                    res.writeHead(400);
                    console.log("400- request failed");
                } else {
                    res.writeHead(200);
                }

                /* caching wildcards to improve speed */
                cache[urlString] = response.body;

                res.write(response.body);
                res.end();
            });
        }
    }
});

/* polychrome listen */
var httpserver = http.createServer(app);
httpserver.listen(app.get('port'), function () {
    console.log('Express server listening on port ' + app.get('port'));
});

/* peer server */
//new PeerServer({
//    port: 8000
//});

var server = PeerServer({port: 8000, path: '/polychrome', allow_discovery: true, key: 'peerjs'});

/* socket io */
var io = require('socket.io').listen(httpserver);

// Delete this row if you want to see debug messages
io.set('log level', 1);

var hashCode = function (str) {
    var hash = 0;
    if (str.length == 0) return hash;
    for (i = 0; i < str.length; i++) {
        char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return hash;
}

// Listen for incoming connections from clients
io.sockets.on('connection', function (socket) {

    // Start listening for mouse events
    socket.on('MouseEvents', function (data) {
        
        var date = new Date();
        data['date'] = date.toString();

        //if (currentPage && currentPage.url) {

        //    fs.appendFile('cache/interaction-' + hashCode(currentPage.url) + '.json', JSON.stringify(data) + '\n', function (err) {
        //        if (err)
        //            console.log(err);
        //    });

        //} else {

        fs.appendFile('cache/interaction-'+data.url+ '.json', JSON.stringify(data) + ',\n', function (err) {
            if (err)
                console.log(err);
        });

        //}
        
    });


    socket.on('getMouseEvents', function (data) {
        console.log(JSON.stringify(data));

        //var events = fs.readFileSync('cache/interaction-'+data.url+ '.json', 'utf8')
        //var parsedEvents = JSON.parse("["+ events +"{}]");
        //socket.emit('MouseEvents',parsedEvents);
    });
});

//app.get('/getPage', function (req, res) {

//    var parsedUrl = url.parse(req.url, true); // true to get query as object
//    var params = parsedUrl.query;

//    var selectedUrl = "";

//    var peerId = "";
//    if (JSON.stringify(params) !== '{}') {
//        selectedUrl = String(params.url);
//        peerId = String(params.peerId);
//    }

//    //var parsedUrl = url.parse(req.url, true); // true to get query as object
//    //var params = parsedUrl.query;

//    //var selectedUrl = "http://multiviz.gforge.inria.fr/scatterdice/oscars/";
//    //var spaceConfiguration = 1;
//    //var displayConfiguration = 1;

//    ////var selectedUrl = String(req.body.url);
//    //console.log("Requested URL -" + selectedUrl);
//    ////var spaceConfiguration = parseInt(req.body.space);
//    //var displayConfiguration = parseInt(req.body.display);

//    var page = new WebPage({
//        url: selectedUrl,
//        spaceConfig: 1,
//        displayConfig: 1
//    });

//    page.parseUrl();
//    currentPage = page;

//    var currentPageCache = cache[page.parseUrl()];
//    if (currentPageCache) {
//        console.log('Served from Cache '+page.parseUrl());
//        res.write(currentPageCache);
//        res.end();

//    } else {
//        //request for the webpage content
//        request({ uri: page.parseUrl() }, function (err, response, body) {
//            var isBlocked = 'No';

//            console.log('Served from Internet '+page.parseUrl());
//        
//            // If the page was found...
//            if (!err && response.statusCode == 200) {
//                // Grab the headers
//                var headers = response.headers;

//                // Grab the x-frame-options header if it exists
//                var xFrameOptions = headers['x-frame-options'] || '';

//                // Normalize the header to lowercase
//                xFrameOptions = xFrameOptions.toLowerCase();

//                // Check if it's set to a blocking option
//                if (
//     			xFrameOptions === 'sameorigin' ||
//     			xFrameOptions === 'deny'
//     			) {
//                    isBlocked = 'Yes';
//                }

//            } else {
//                res.end("PAGE NOT FOUND");
//            }


//            /* using cheerio to manipulate the DOM */
//            $ = cheerio.load(body);

//            $('script').each(function () {
//                var link = $(this).attr('src');
//                if (link !== undefined && link.indexOf("http") == -1) {
//                    var url = selectedUrl + link;
//                    if (link.charAt(0) === '/') {
//                        var baseUrl = page.getbaseUrl();
//                        page.setCurrentBaseUrl(baseUrl);
//                        url = baseUrl + link;
//                        if (baseUrl.charAt(baseUrl.length - 1) === '/') {
//                            url = baseUrl + link.substr(1);
//                        }
//                    } else {
//                        if (selectedUrl.charAt(selectedUrl.length - 1) !== '/') {
//                            url = selectedUrl + "/" + link;
//                        }
//                    }
//                    console.log(url);
//                    $(this).attr('src', url);
//                }
//            });

//            $('link').each(function () {
//                var css = $(this).attr('href');
//                if (css.indexOf(".com") == -1) {
//                    var url = selectedUrl + css;
//                    if (css.charAt(0) === '/') {
//                        var baseUrl = page.getbaseUrl();
//                        currentPage.setCurrentBaseUrl(baseUrl);
//                        url = baseUrl + css;
//                        if (baseUrl.charAt(baseUrl.length - 1) === '/') {
//                            url = baseUrl + css.substr(1);
//                        }
//                    } else {
//                        if (selectedUrl.charAt(selectedUrl.length - 1) !== '/') {
//                            url = selectedUrl + "/" + css;
//                        }
//                    }
//                    console.log(url);
//                    $(this).attr('href', url);
//                }
//            });

//            $('image').each(function () {
//                var image = $(this).attr('href');
//                if (image !== undefined && image.indexOf(".com") == -1) {
//                    var url = selectedUrl + image;
//                    if (image.charAt(0) === '/') {
//                        var baseUrl = page.getbaseUrl();
//                        currentPage.setCurrentBaseUrl(baseUrl);
//                        url = baseUrl + image;
//                        if (baseUrl.charAt(baseUrl.length - 1) === '/') {
//                            url = baseUrl + image.substr(1);
//                        }
//                    } else {
//                        if (selectedUrl.charAt(selectedUrl.length - 1) !== '/') {
//                            url = selectedUrl + "/" + image;
//                        }
//                    }
//                    console.log(url);
//                    $(this).attr('href', url);
//                }
//            });

//            $('a').each(function () {
//                var hyperlink = $(this).attr('href');
//                if (hyperlink !== undefined && hyperlink.indexOf(".com") == -1) {
//                    var url = selectedUrl + hyperlink;
//                    if (hyperlink.charAt(0) === '/') {
//                        var baseUrl = page.getbaseUrl();
//                        currentPage.setCurrentBaseUrl(baseUrl);
//                        url = baseUrl + hyperlink;
//                        if (baseUrl.charAt(baseUrl.length - 1) === '/') {
//                            url = baseUrl + hyperlink.substr(1);
//                        }
//                    } else {
//                        if (selectedUrl.charAt(selectedUrl.length - 1) !== '/') {
//                            url = selectedUrl + "/" + hyperlink;
//                        }
//                    }
//                    console.log(url);
//                    $(this).attr('href', url);
//                }
//            });

//            $('body').prepend('<link rel="stylesheet" href="stylesheets/polychrome_style.css"></link>');
//            $('head').append('<link rel="shortcut icon" href="images/polychrome-icon.png" />');
//            $('body').prepend('<script type="text/javascript" src="javascripts/polychrome-peer.js"></script>');
//            $('body').prepend('<script type="text/javascript" src="javascripts/polychrome-accesspanel.js"></script>');
//            $('body').attr('id', 'chrome_body');

//            var polychrome_panel = fs.readFileSync("public/renderings/accesspanel.txt", 'utf8');
//            $('body').append(polychrome_panel.toString());

//            cache[page.parseUrl()] = '<html>' + $.html() + '</html>';
//            res.write('<html>' + $.html() + '</html>');
//            res.end();
//        });
//    }
//});

