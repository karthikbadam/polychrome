
/*
 * GET home page.
 */

exports.index = function(req, res){
  res.render('index', { title: 'PolyChrome'});
};


exports.drawing = function(req, res){
  res.render('drawing', {});
};


exports.choropleth = function(req, res){
  res.render('choropleth', {});
};


exports.scatterplot = function(req, res){
  res.render('scatterplot', {});
};


exports.iris = function(req, res){
  res.render('iris-scatterplot', {});
};


exports.map = function(req, res){
  res.render('mapexplore', {});
};


exports.preso = function(req, res){
  res.render('preso', {});
};