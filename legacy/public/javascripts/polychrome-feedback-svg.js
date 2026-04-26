
/* PolyChrome SVG feedback panel */

function FeedbackPanel (options) {
    var _self = this;

    _self.div = d3.select("#pc-event-capturer");

     _self.margin = {
        top: 0,
        right: 0,
        bottom: 0,
        left: 0
    };

    _self.svgWidth = $('#pc-event-capturer').width() - _self.margin.left - _self.margin.right;
    _self.svgHeight = $('#pc-event-capturer').height() - _self.margin.top - _self.margin.bottom;

    _self.svg = _self.div.append("svg");

    _self.svg.attr("id", "pc-event-capturerSVG")
        .attr("width", _self.svgWidth + _self.margin.left + _self.margin.right)
        .attr("height", _self.svgHeight + _self.margin.top + _self.margin.bottom);
 
}

FeedbackPanel.prototype.attachEvent = function (eventType, Handler) {
    var _self = this;
    _self.svg.on(eventType, function(d) {
        var event = d3.event;
        Handler(event);
    });

};