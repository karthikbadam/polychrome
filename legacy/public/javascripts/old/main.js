/**
 * @author Karthik Badam
 * created in July 2013
 */

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

//arraylist of all connections
var connections = [];

function randomString(len, charSet) {
    charSet = charSet || 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var randomString = '';
    for (var i = 0; i < len; i++) {
    	var randomPoz = Math.floor(Math.random() * charSet.length);
    	randomString += charSet.substring(randomPoz,randomPoz+1);
    }
    return randomString;
}

//once you get some data on the peerjs connection
function onData(data) {
	//alert(data);
	if (data.eventType == "click") {
		var url = domain+data.message;
		load_page(url);
	} 
	if (data.eventType == "scroll") {
		$(window).scroll();
	}

}

//on connection 
function connect(conn) {
	conn.on('open', function(){
		connections.push(conn);
		alert("Now connected to "+conn.peer);
		//first_connection(conn);
	});
	
	conn.on('data', function (data) {
		if (data != null)
			onData(data);
		
	});
}

//TODO change me to work with a server
var randomValue = randomString(5);
var peer = new Peer(
	{host: 'localhost', port:'8000'}
);

peer.on('open', function(id, clientIds) {
	$('#pid').text(id);
	console.log(clientIds);

	var peer1 = clientIds.split(",");
	console.log(peer1[0]);
	peer1.forEach(function(peerid) {
		var conn = peer.connect(peerid);
		conn.on('open', function() {
			connections.push(conn);
			alert("Now connected to "+conn.peer);
		 	//first_connection(c);
	 	});

	 	conn.on('data', function(data) {
	 		if (data != null)
	 			onData(data);
	 	});

	})	
});

//make sure that peerjs connections are handled by the connect function
peer.on('connection', connect);
var domain = null;

function load_page(url) {
	
	if ($('#ifrm1').length == 0){
        alert('Please select a screen option');
        return;
    }

    //parse url to get domain
    if(domain == null) {
		var url_parts = url.split("/");
	    url_parts.forEach(function(url_part) {
	    	if ((url_part.indexOf(".org") > 0) || (url_part.indexOf(".com") > 0) ||
	    			(url_part.indexOf(".edu")  > 0 ) || (url_part.indexOf(".co.") > 0)) {
	    		console.log(url_part);
	    		domain = url_part;
	    	}
	    });
	}

	var filename = null;
	var data = 	{
		str : url
	};

	$.ajax({
        type: "POST",
        url: "/polychrome1.0/php/downloadpage.php",
        data: data,
        cache: false,
        success: function(data)
        {
        	filename = "/polychrome1.0/php/"+data;

        	$('#ifrm1').attr('src', filename);

		    $('#ifrm1').load(function() {

		    	$('#ifrm1').contents().find('a').each(function() {
				  var href = $(this).attr('href');
				  $(this).click(function() { 
				  	var url = domain+href;
				  	load_page(url);
				  	
				  	//multicast
				  	var data = makeMessage("click", href);
				  	connections.forEach(function(connection) {
				  		connection.send(data);
				  	});		
				  	
				   }).removeAttr('href');
				});
		    });
		}
    });

}


//change this when deployed
var hostname= "localhost";
var port= "9000";

$(document).ready(function() {

	$("#toggle").click(function () {
		$('#toggle').toggleClass('active');
		$("#actions").slideToggle("slow");
	});

	$("#url").keyup(function(e){ 
	    var code = e.which; // recommended to use e.which, it's normalized across browsers
	    if(code==13)e.preventDefault();
	    if(code==32||code==13||code==188||code==186){
	        load_page($(this).val());
	    } 
	});

	$("#url_submit").click(function () {
		
		load_page($("#url").val());
	});


	//login management
	$("#login_submit").click(function() {
		// var username = $("#username").val();
		// var password = $("#password").val();
		// var message = [];
		// message.push({id: username, password: password});	
		// console.log(message);

		// var http = new XMLHttpRequest();
    	// var url = 'http://' + hostname + ':' + port + '/login';
    	// http.open('post', url, true);
    	// http.setRequestHeader('Content-Type', 'application/json');
    	// http.send(message);
    	var form = $('#login_form');

    	// var url = 'http://' + hostname + ':' + port + '/login';
    	// form.setAttribute("method", "post");
    	// form.setAttribute("action", url);
    	// form.submit();

	});	

	///handle scroll events on iframe!
	function handle_scroll() {
		$(window).scroll(function () {
			console.log("scroll event");
			var data = makeMessage("scroll");
			connections.forEach(function(connection) {
				connection.send(data);
			});	
		});
	}

	//select a screen type
	$("#one-screen").click(function() {
		if ($('#ifrm1').length == 0){
			$("body").append('<div id="polychrome-container-onescreen"></div>');
			$("#polychrome-container-onescreen").append('<iframe id="ifrm1" scrolling="yes"></iframe>');
			handle_scroll();
		}
	});

	$("#two-screen-left").click(function() {
		if ($('#ifrm1').length == 0){
			$("body").append('<div id="polychrome-container-twoscreen-left"></div>');
			$("#polychrome-container-twoscreen-left").append('<iframe id="ifrm1" scrolling="yes"></iframe>');
			handle_scroll();
		}
	});


	$("#two-screen-right").click(function() {
		if ($('#ifrm1').length == 0){
			$("body").append('<div id="polychrome-container-twoscreen-right"></div>');
			$("#polychrome-container-twoscreen-right").append('<iframe id="ifrm1" scrolling="yes"></iframe>');
			handle_scroll();
		}
	});

	$("#four-screen-left-top").click(function() {
		if ($('#ifrm1').length == 0){
			$("body").append('<div id="polychrome-container-fourscreen-lefttop"></div>');
			$("#polychrome-container-fourscreen-lefttop").append('<iframe id="ifrm1" scrolling="yes"></iframe>');
			handle_scroll();
		}
	});

	$("#four-screen-right-top").click(function() {
		if ($('#ifrm1').length == 0){
			$("body").append('<div id="polychrome-container-fourscreen-righttop"></div>');
			$("#polychrome-container-fourscreen-righttop").append('<iframe id="ifrm1" scrolling="yes"></iframe>');
			handle_scroll();
		}
	});

	$("#four-screen-left-bottom").click(function() {
		if ($('#ifrm1').length == 0){
			$("body").append('<div id="polychrome-container-fourscreen-leftbottom"></div>');
			$("#polychrome-container-fourscreen-leftbottom").append('<iframe id="ifrm1" scrolling="yes"></iframe>');
			handle_scroll();
		}
	});

	$("#four-screen-right-bottom").click(function() {
		if ($('#ifrm1').length == 0){
			$("body").append('<div id="polychrome-container-fourscreen-rightbottom"></div>');
			$("#polychrome-container-fourscreen-rightbottom").append('<iframe id="ifrm1" scrolling="yes"></iframe>');
			handle_scroll();
		}
	});
});


