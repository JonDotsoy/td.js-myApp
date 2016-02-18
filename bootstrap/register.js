/**
* With ES6.
*/

var path = require("path");
var fs = require("fs");

console.log("[APP] Start APP.");

require("babel-core/register");
require("babel-polyfill");
require(path.resolve("./bootstrap/index.js"));
