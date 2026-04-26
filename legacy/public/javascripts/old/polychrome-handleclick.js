/**
 * @author Karthik Badam
 * created in July 2013
 */
var myclick = false; 
$(document).on("click", function(evt) { 
	if (evt.target.nodeName !== "circle") { 
		return;
	} 
	alert("captured event "+myclick); 
	var elem = document.elementFromPoint(evt.pageX, evt.pageY); 
	if (!myclick) { 
		var clickevt = document.createEvent("MouseEvents"); 
		clickevt.initMouseEvent("click", true, true, window, 1, evt.pageX, evt.pageY, evt.pageX, evt.pageY, false, false, false, false, 0, null); 
		alert("generated event "+ myclick); myclick = true; 
		/* elem.dispatchEvent(clickevt); */ 
	} 
	else {
		myclick = false;
	} 
}); 
