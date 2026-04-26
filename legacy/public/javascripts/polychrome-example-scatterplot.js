
var Panel = {
    panel: null,
    x: 0,
    y: 0,
    scale: 1,
    rotation: 0,
    zoomScale: 0.8,
    annotations: null,
    hostvis: null,
    width: 0,
    height: 0,
    bbox: null,
    start: null,
    inUse: false,
    color: null,

    init: function (svg, width, height) {
        var _self = this;
        _self.panel = svg.append("g");
        _self.width = width;
        _self.height = height;

        _self.color = d3.scale.category10();

        /* viewport polychrome rectangle */
        _self.panel.append("rect")
                   .attr("width", width)
                   .attr("height", height)
                   .attr("id", "polychrome-rect-panel")
                   .style("fill", "transparent")
                   .style("stroke", "rgba(0, 0, 0, 0.1")
                   .style("z-index", 100);

        var clipped = _self.panel.append("g").attr("clip-path", "url(#panel)");

        // Set the clip path for the new panel
        var clip = _self.panel.append("clipPath").attr("id", "panel");
        clip.append("rect").attr("width", width).attr("height", height);

        // Create the viewport
        _self.viewport = clipped.append("g").attr("id", "polychrome-Port");
        _self.hostvis = _self.viewport.append("g");

        return _self.hostvis;
    },

    install: function () {
        Panel.panel.on("mousedown", Panel.mousedown);
        Panel.panel.on("mousemove", Panel.mousemove);
        Panel.panel.on("mouseup", Panel.mouseup);

        Panel.panel.on("touchstart", Panel.touchstart);
        Panel.panel.on("touchmove", Panel.touchmove);
        Panel.panel.on("touchend", Panel.touchend);
    },

    uninstall: function () {
        Panel.panel.on("mouseup", null);
        Panel.panel.on("mousemove", null);
        Panel.panel.on("mousedown", null);
        Panel.panel.on("touchend", null);
        Panel.panel.on("touchmove", null);
        Panel.panel.on("touchstart", null);
    },

    getBoundingBox: function (curr) {
        var minX = Math.min(curr[0], Panel.start[0]);
        var maxX = Math.max(curr[0], Panel.start[0]);
        var minY = Math.min(curr[1], Panel.start[1]);
        var maxY = Math.max(curr[1], Panel.start[1]);
        return [minX, minY, maxX - minX, maxY - minY];
    },

    mousedown: function () {

        // Prevent Browser's default behaviour
        d3.event.preventDefault();
        Panel.start = d3.mouse(this);

        var event = d3.event;

        if (event.isPolyChrome) {

            if (DisplayConfiguration.TAG == "PIVOTWALL" || event.deviceId == deviceId) {

                if (DisplayConfiguration.TAG == "TABLET" && Panel.bbox) {

                    Panel.bbox.remove();
                    Panel.bbox = null;
                }

                var color1 = "#aaa";

                if (deviceId != event.deviceId)
                    color1 = Panel.color(event.deviceId);

                // bounding box
                Panel.bbox = Panel.panel.append("rect")
                                    .attr("id", "polychrome-selection")
                                    .attr("x", Panel.start[0])
                                    .attr("y", Panel.start[1])
                                    .attr("width", "5")
                                    .attr("height", "5")
                                    .style("fill", color1)
                                    .style("fill-opacity", 0.3);

                Panel.inUse = true;
            }

        } else {

            /* recycle event and send it to other peers */
            PolyChromeEventHandler.wrapEvent(event.type, event.pageX, event.pageY, event.target, event);
            PolyChromeEventHandler.shareEvent();
        }

    },

    mousemove: function () {
        var event = d3.event;
        d3.event.preventDefault();

        if (event.isPolyChrome) {
            if (Panel.inUse) {
                // Update the selection
                var box = Panel.getBoundingBox(d3.mouse(this));
                if (Panel.bbox)
                    Panel.bbox.attr("x", box[0]).attr("y", box[1]).attr("width", box[2]).attr("height", box[3]);
            }
        } else {
            if (Panel.inUse) {

                /* recycle event and send it to other peers */
                PolyChromeEventHandler.wrapEvent(event.type, event.pageX, event.pageY, event.target, event);
                PolyChromeEventHandler.shareEvent();
            }
        }
    },

    mouseup: function () {
        var event = d3.event;
        d3.event.preventDefault();

        if (event.isPolyChrome) {
            if (Panel.inUse) {

                // Forward the selection
                if (DisplayConfiguration.TAG == "TABLET") {
                    var box = Panel.getBoundingBox(d3.mouse(this));
                    Toolbox.select([[(box[0] - Panel.x), (box[1] - Panel.y)], [(box[0] - Panel.x), (box[1] - Panel.y) + box[3]], [(box[0] - Panel.x) + box[2], (box[1] - Panel.y) + box[3]], [(box[0] - Panel.x) + box[2], (box[1] - Panel.y)]], Toolbox.inclusive);

                    // Remove the bounding box

                    //Panel.bbox.remove();   
                }

                Panel.inUse = false;
            }
        }

        else {
            if (Panel.inUse) {
                /* recycle event and send it to other peers */
                PolyChromeEventHandler.wrapEvent(event.type, event.pageX, event.pageY, event.target, event);
                PolyChromeEventHandler.shareEvent();

            }
        }
    },

    touchstart: function () {
        // Prevent Browser's default behaviour
        d3.event.preventDefault();
        Panel.start = d3.mouse(this);

        var event = d3.event;

        if (event.isPolyChrome) {
            // bounding box
            Panel.bbox = Panel.panel.append("rect")
                                    .attr("id", "polychrome-selection")
                                    .attr("x", Panel.start[0])
                                    .attr("y", Panel.start[1])
                                    .attr("width", "5")
                                    .attr("height", "5")
                                    .style("fill", "#aaa")
                                    .style("fill-opacity", 0.4);
            Panel.inUse = true;

        } else {

            /* recycle event and send it to other peers */
            PolyChromeEventHandler.wrapEvent("mousedown", event.touches[0].pageX, event.touches[0].pageY, event.target, event);
            PolyChromeEventHandler.shareEvent();
        }
    },

    lastX: 0,
    lastY: 0,

    touchmove: function () {

        var event = d3.event;
        d3.event.preventDefault();

        if (event.isPolyChrome) {
            if (Panel.inUse) {
                // Update the selection
                var c = d3.mouse(this);
                Panel.lastX = c[0];
                Panel.lastY = c[1];
                var box = Panel.getBoundingBox(d3.mouse(this));
                if (Panel.bbox)
                    Panel.bbox.attr("x", box[0]).attr("y", box[1]).attr("width", box[2]).attr("height", box[3]);
            }
        } else {
            if (Panel.inUse) {
                Panel.lastX = event.touches[0].pageX;
                Panel.lastY = event.touches[0].pageY;

                /* recycle event and send it to other peers */
                PolyChromeEventHandler.wrapEvent("mousemove", event.touches[0].pageX, event.touches[0].pageY, event.target, event);
                PolyChromeEventHandler.shareEvent();
            }
        }
    },



    touchend: function () {
        var event = d3.event;
        d3.event.preventDefault();

        if (event.isPolyChrome) {
            if (Panel.inUse) {

                // Forward the selection
                var box = Panel.getBoundingBox(d3.mouse(this));
                Toolbox.select([[(box[0] - Panel.x), (box[1] - Panel.y)], [(box[0] - Panel.x), (box[1] - Panel.y) + box[3]], [(box[0] - Panel.x) + box[2], (box[1] - Panel.y) + box[3]], [(box[0] - Panel.x) + box[2], (box[1] - Panel.y)]], Toolbox.inclusive);

                // Remove the bounding box
                Panel.bbox.remove();
                Panel.bbox = null;
                Panel.inUse = false;
            }
        }

        else {
            if (Panel.inUse) {

                /* recycle event and send it to other peers */
                PolyChromeEventHandler.wrapEvent("mouseup", Panel.lastX, Panel.lastY, event.target, event);
                PolyChromeEventHandler.shareEvent();

            }
        }
    }

};


var Toolbox = {
    svg: null,
    viewport: null,
    captured: null,
    inclusive: true,

    init: function (svg, viewport) {
        var _self = this;
        _self.svg = svg;
        _self.viewport = viewport;
    },

    select: function (points, inclusive) {
        var _self = this;
        var shapebound = new createPolygon(points);
        _self.captured = selectionLoop(shapebound, inclusive);


        var currentColor = getRandomColor();
        var hits = _self.captured;
        var query = brushed(hits);
        
        Panel.viewport.selectAll("circle").style("fill", "#CCC");

        for (var i = 0; i < query.length; i++) {
            _self.addEllipseLayer(query[i], currentColor);
        }
    },

    addEllipseLayer: function (ellipse, currentColor) {
        var T = ellipse.getAttributeNS(null, "transform")
        var cx = parseFloat(ellipse.getAttributeNS(null, "cx"));
        if (ellipse.getAttributeNS(null, "cx") == "") {
            cx = 0;
        }
        var cy = parseFloat(ellipse.getAttributeNS(null, "cy"));
        if (ellipse.getAttributeNS(null, "cy") == "") {
            cy = 0;
        }
        if (ellipse.tagName == "ellipse") {
            var rx = parseFloat(ellipse.getAttributeNS(null, "rx"));
            var ry = parseFloat(ellipse.getAttributeNS(null, "ry"));
        } else {
            var rx = parseFloat(ellipse.getAttributeNS(null, "r"));
            var ry = rx;
        }

        var class1 = ellipse.getAttributeNS(null, "class");
        var id = ellipse.getAttributeNS(null, "id");
        
        var C = Panel.viewport.select("#"+id)
				.attr("cx", cx)
				.attr("cy", cy)
				.attr("r", rx)
				.attr("display", "inline")
				.style("fill", color(class1))
				.style("opacity", 1)
				.attr("pointer-events", "none")
				.attr("transform", T)
    }
}

function getRandomColor() {
    var letters = '0123456789ABCDEF'.split('');
    var color = '#';
    for (var i = 0; i < 6; i++ ) {
        color += letters[Math.round(Math.random() * 15)];
    }
    return color;
}

var width = document.documentElement.clientWidth,
    height = document.documentElement.clientHeight - 25;
    size = height / 4 ,
    Padding = 20;

var svg = d3.select("body").append("svg")
    .attr("width", width)
    .attr("height", height+Padding);

var viewport = Panel.init(svg, width, height+Padding);
viewport.attr("transform", "translate(" + width / 4 + ", 0)");
Panel.install();

/* initializing PolyChrome */
PolyChromeEventHandler.init();
PeerConnection.init();
FeedbackPanel.init();
ServerConnection.init("scatterplot");
/* end PolyChrome block */

var circle_query = [];

var x = d3.scale.linear()
    .range([Padding / 2, size - Padding / 2]);

var y = d3.scale.linear()
    .range([size - Padding / 2, Padding / 2]);

var xAxis = d3.svg.axis()
    .scale(x)
    .orient("bottom")
    .ticks(5);

var yAxis = d3.svg.axis()
    .scale(y)
    .orient("left")
    .ticks(5);

var color = d3.scale.category10();
var radius = 3;

d3.csv("/polychrome-datasets/flowers.csv", function (error, data) {
    var domainByTrait = {},
      traits = d3.keys(data[0]).filter(function (d) { return d !== "species"; }),
      n = traits.length;

    traits.forEach(function (trait) {
        domainByTrait[trait] = d3.extent(data, function (d) { return d[trait]; });
    });

    xAxis.tickSize(size * n);
    yAxis.tickSize(-size * n);


    viewport.selectAll(".x.axis")
      .data(traits)
    .enter().append("g")
      .attr("class", "x axis")
      .attr("transform", function (d, i) { return "translate(" + (n - i - 1) * size + ",0)"; })
      .each(function (d) { x.domain(domainByTrait[d]); d3.select(this).call(xAxis); });

    viewport.selectAll(".y.axis")
      .data(traits)
    .enter().append("g")
      .attr("class", "y axis")
      .attr("transform", function (d, i) { return "translate(0," + i * size + ")"; })
      .each(function (d) { y.domain(domainByTrait[d]); d3.select(this).call(yAxis); });

    var cell = viewport.selectAll(".cell")
      .data(cross(traits, traits))
    .enter().append("g")
      .attr("class", "cell")
      .each(plot);

    // Titles for the diagonal.
    cell.filter(function (d) { return d.i === d.j; }).append("text")
      .attr("x", Padding)
      .attr("y", Padding)
      .attr("dy", ".71em")
      .attr("transform", function (d) {
          return "translate(" + (n - d.i - 1) * size + "," + d.j * size + ")";
      })
      .text(function (d) { return d.x; });

    function plot(p) {
        var cell = d3.select(this);

        x.domain(domainByTrait[p.x]);
        y.domain(domainByTrait[p.y]);

        cell.append("rect")
        .attr("class", "frame")
        .attr("x", Padding / 2)
        .attr("y", Padding / 2)
        .attr("width", size - Padding)
        .attr("height", size - Padding)
        .attr("transform", function (d) {
            return "translate(" + (n - d.i - 1) * size + "," + d.j * size + ")";
        });

        cell.selectAll("circle")
        .data(data)
        .enter().append("circle")
        .attr("class", function (d) { return d.species })
        .attr("cx", function (d) { return (n - p.i - 1) * size + x(d[p.x]); })
        .attr("cy", function (d) { return p.j * size + y(d[p.y]); })
        .attr("r", radius)
        //.style("fill", function (d) { return "#CCC"; });
        .style("fill", function (d) { return color(d.species); });
    }

    function cross(a, b) {
        var c = [], n = a.length, m = b.length, i, j;
        for (i = -1; ++i < n; ) for (j = -1; ++j < m; ) c.push({ x: a[i], i: i, y: b[j], j: j });
        return c;
    }

    d3.select(self.frameElement).style("height", size * n + Padding + 20 + "px");

    /* call polychromify */
    PolyChromeEventHandler.polyChromify();
    FeedbackPanel.setDisplayBackground();
    
    /* state synchronization */
    ServerConnection.get();
});


function selectionLoop(shapebound, inclusive) {
    var num = 0;
    var cells = d3.selectAll(".cell")[0]
    var hits = [];
    circle_query[num] = [];
    for (var i = 0; i < cells.length; i++) {
        for (var j = 1; j < cells[i].children.length; j++) {
            var circles = cells[i].children[j]
            var captured = shapebound.intersectEllipse([circles], inclusive)
            if (captured.length == 1) {
                hits.push(captured[0])
                if (circle_query[num].indexOf(j) == -1) circle_query[num].push(j)
            }
        }
    }
    return hits;
}

function brushed(hits) {
    var num = 1;
    var cells = d3.selectAll(".cell")[0]
    var query = hits;
    if (circle_query[num - 1] == undefined) circle_query[num - 1] = [];
    for (var i = 0; i < cells.length; i++) {
        for (var j = 1; j < cells[i].children.length; j++) {
            if (circle_query[num - 1].length >= 1) {
                if (circle_query[num - 1].indexOf(j) != -1) {
                    query.push(cells[i].children[j])
                }
            }
        }
    }
    return query;
}

