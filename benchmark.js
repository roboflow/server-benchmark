/*jshint esversion:8*/

const async = require("async");
const axios = require("axios");
const _ = require("lodash");

const process = require("process");
const fs = require("fs");

const CONFIG = {
    server: "https://detect.roboflow.com", // or your server IP, eg "http://192.168.4.128:9001"
    model: "egohands-public/5", // your model ID here
    parallelism: 32, // how many async requests to fire at a time; use 1 to use sequential mode
    api_key: (
        findAndReadFile(".roboflow_key") ||
        process.env.ROBOFLOW_KEY ||
        process.env.ROBOFLOW_API_KEY ||
        "YOUR API KEY HERE"
    ),
    trt: true // set to false unless using the :trt or :trt-jetson dockers which need to be warmed up
};

var buffers = {};
const images = fs.readdirSync("images");
_.each(images, function(path) {
    buffers[path] = fs.readFileSync("images/" + path, {
        encoding: "base64"
    });
});

warmup().then(function() {
    var begin = Date.now();
    async.eachOfLimit(buffers, CONFIG.parallelism, function(buffer, path, cb) {
        infer(buffer, path)
            .finally(function() {
                cb(null);
            });
    }, function() {
        var elapsed = ((Date.now() - begin)/1000).toFixed(2);
        console.log("Inferred", images.length, "times in", elapsed, "seconds", images.length/elapsed, "fps");
    });
});

/* recursively searches for file in this or any parent directory and returns its contents */
function findAndReadFile(filename) {
    var dir_parts = process.cwd().split("/");

    var filepath;
    while(dir_parts.length) {
        filepath = dir_parts.join("/") + "/" + filename;
        if(fs.existsSync(filepath)) return fs.readFileSync(filepath, 'utf-8').trim();
        dir_parts.pop();
    }
}

function warmup() {
    return new Promise(function(resolve, reject) {
        var start = Date.now();
        console.log("Warming up...");

        // trt servers have a special warmup; otherwise hit it with an inference to load weights into memory
        if(!CONFIG.trt) {
            infer(buffers[images[0]], images[0]).then(function(response) {
                var elapsed = ((Date.now() - start)/1000).toFixed(2);
                console.log("Warmup took", elapsed, "seconds");
                resolve(response);
            });
            return;
        }

        axios({
            method: "GET",
            url: [CONFIG.server, "start", CONFIG.model].join("/"),
            params: {
                api_key: CONFIG.api_key
            }
        })
        .then(function(response) {
            var elapsed = ((Date.now() - start)/1000).toFixed(2);
            console.log("Warmup took", elapsed, "seconds");
            resolve(response);
        })
        .catch(function(error) {
            console.log("Warmup failed.");

            if (error.response) {
                // Request made and server responded
                console.log(error.response.data);
                console.log(error.response.status);
                console.log(error.response.headers);
            } else if (error.request) {
                // The request was made but no response was received
                console.log(error.request);
            } else {
                // Something happened in setting up the request that triggered an Error
                console.log('Error', error.message);
            }

            reject(e);
        });
    });
}

function infer(buffer, path) {
    return new Promise(function(resolve, reject) {
        var start = Date.now();
        axios({
            method: "POST",
            url: [CONFIG.server, CONFIG.model].join("/"),
            params: {
                api_key: CONFIG.api_key
            },
            data: buffer,
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            }
        })
        .then(function(response) {
            var predictions = response.data;

            var elapsed = ((Date.now() - start)/1000).toFixed(2);
            console.log("Inference on", path, "found", predictions.length, "objects in", elapsed, "seconds");
            resolve(response);
        })
        .catch(function(error) {
            console.log("Inference failed on", path);

            if (error.response) {
                // Request made and server responded
                console.log(error.response.data);
                console.log(error.response.status);
                console.log(error.response.headers);
            } else if (error.request) {
                // The request was made but no response was received
                console.log(error.request);
            } else {
                // Something happened in setting up the request that triggered an Error
                console.log('Error', error.message);
            }

            reject(error);
        });
    });
}
