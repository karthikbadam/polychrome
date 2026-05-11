$(function () {

    // This demo depends on the canvas element
    if (!('getContext' in document.createElement('canvas'))) {
        alert('Sorry, it looks like your browser does not support canvas!');
        return false;
    }

    // The URL of your web server (the port is set in app.js)
    var url = 'http://localhost:3000';

    var doc = $(document),
        win = $(window),
        instructions = $('#instructions');

    // get the canvas element and its context
    var canvas = document.getElementById('paper');
    var ctx = canvas.getContext('2d'), context = canvas.getContext('2d');

    // Generate an unique ID
    var id = Math.round($.now() * Math.random());

    // A flag for drawing activity
    var drawing = false;

    var clients = {};
    var cursors = {};
    var prev = {};

    // create a drawer which tracks touch movements
    var drawer = {
        touchstart: function (coors) {
            context.beginPath();
            context.moveTo(coors.x, coors.y);
            drawing = true;
        },
        touchmove: function (coors) {
            if (drawing) {
                context.lineTo(coors.x, coors.y);
                context.stroke();
            }
        },
        touchend: function (coors) {
            if (drawing) {
                //this.touchmove(coors);
                context.stroke();
                drawing = false;
            }
        },
        mousedown: function (coors) {
            context.beginPath();
            context.moveTo(coors.x, coors.y);
            drawing = true;
        },
        mousemove: function (coors) {
            if (drawing) {
                context.lineTo(coors.x, coors.y);
                context.stroke();
            }
        },
        mouseup: function (coors) {
            if (drawing) {
                context.stroke();
                drawing = false;
            }
        }
    };

    // create a function to pass touch events and coordinates to drawer
    function draw(event) {
        // get the touch coordinates
        if (event.type.indexOf("touch") >= 0) {
            var coors = {
                x: event.targetTouches[0].pageX,
                y: event.targetTouches[0].pageY
            };
            // pass the coordinates to the appropriate handler
            drawer[event.type](coors);
            event.preventDefault();
        } else {
            var coors = {
                x: event.pageX,
                y: event.pageY
            };
            // pass the coordinates to the appropriate handler
            drawer[event.type](coors);
            event.preventDefault();
        
        }
        
    }

    // attach the touchstart, touchmove, touchend event listeners.
    $('canvas').on('touchstart', draw);
    $('canvas').on('touchmove', draw);
    $('canvas').on('touchend', draw);
    $('canvas').on('mousedown', draw);
    $('canvas').on('mouseup', draw);
    $('canvas').on('mousemove', draw);

    function drawLine(fromx, fromy, tox, toy) {
        ctx.moveTo(fromx, fromy);
        ctx.lineTo(tox, toy);
        ctx.stroke();
    }

    $('#polychrome-display-dump').css({ 'background-color': 'rgba(100, 100, 100, 1)' });
    $('#polychrome-display-dump').css('background-image', 'none');

    html2canvas(document.body, {
        onrendered: function (canvas) {
            canvas.width = $('#polychrome-display-dump').width();
            canvas.height = $('#polychrome-display-dump').height();
            $('#polychrome-display-dump').append(canvas);

        }
    });
});