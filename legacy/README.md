PolyChrome
=====

A web application framework for collaborative web browsing of both static web pages and dynamic web visualizations.
[PolyChrome is currently under development and we are rapidly improving it. Please contact [us](http://karthikbadam.azurewebsites.net) if you are interested and would like to contribute to our project in any way.]

### To build:

Prerequisites (both Windows and Unix):
    
    * Python 2.6 or 2.7  
    * Visual Studio 2010 or 2012 (Windows)
    * GCC 4.2 or newer (Unix) 
    * Node.js (http://nodejs.org/download/)
    
   
How to download:

    * git clone https://github.com/karthikbadam/PolyChrome.git

  
###How to install and run:

- PolyChrome has numerous dependencies, but thanks to npm (a package manager for node.js), they can all be installed with a single command. Open the PolyChrome folder in your command prompt or terminal and type in:


    * npm install
    
    
- This should take care of the dependencies. Note that PolyChrome is built to use [Express](http://expressjs.com/), a web application framework for node.js.
    
- Now, you can run PolyChrome using:


    * node polychrome-server.js

- PolyChrome has two server components: (1) A proxy server to handle requests from the clients (running at port 3000), and (2) a modified version of [PeerJS](http://peerjs.com/) server to handle the connections between peers/clients (running at port 8080).


###PolyChrome API modules:

- PolyChrome API is now available in _public/api/_ folder. Please take a look at the examples for reference (documentation is in progress). 
 
    * [hostname]:3000/choropleth
    * [hostname]:3000/scatterplot
    * [hostname]:3000/iris

###How to use PolyChrome:

- Open your browser and enter the url "localhost:3000" or "[hostname]:3000", depending on where you are running the server. This will open the following page:
<br><br>
<img src="https://github.com/karthikbadam/PolyChrome/blob/master/screenshots/screenshot-0.PNG?raw=true">

- Note that if you want to try out PolyChrome collaboration on the same device, you have to open the above URL ("[hostname]:3000") in two different tabs, as each tab gets a unique deviceID. 

- Type in a URL in the respective space, and click the triangular icon to submit. Now, PolyChrome fetches the content of this URL by acting as a proxy, and opens it in a new window as follows: 
<br><br>
<img src="https://github.com/karthikbadam/PolyChrome/blob/master/screenshots/screenshot-1.PNG?raw=true">


-  The feedback panel on top right of this page, shows the details of the events being captured, and also the connected peers (highlighted).
<br><br>
<img src="https://github.com/karthikbadam/PolyChrome/blob/master/screenshots/screenshot-2.PNG?raw=true">
  

Resources for Newcomers
---
- [How to install node.js on Windows](http://dailyjs.com/2012/05/03/windows-and-node-1/)
- [The Wiki](https://github.com/karthikbadam/polychrome/wiki)
- A simple multi-device drawing application is also provided with this framework. You can try it out by running PolyChrome and opening "[hostname]:3000/drawing" in your browser.

- PolyChrome Demo -- with examples (youtube)

<a href="http://www.youtube.com/watch?feature=player_embedded&v=pKnRloUAKps
" target="_blank"><img src="http://img.youtube.com/vi/pKnRloUAKps/0.jpg" 
alt="PolyChrome Demo" width="480" height="360" border="10" /></a>

- Some sample webpages that can be used with PolyChrome

   
   * http://multiviz.gforge.inria.fr/scatterdice/oscars/
   * http://bl.ocks.org/VisDockHub/raw/8973882/b0df0fe605374ad0a1950faf2dec5c21b235dd16/
   * http://bl.ocks.org/mbostock/raw/4343214/7156108135e543e2bc60543a05bc9e9abf4a928c/
