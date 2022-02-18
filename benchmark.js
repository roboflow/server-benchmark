/*jshint esversion:8*/

const async = require("async");
const axios = require("axios");
const _ = require("lodash");

const process = require("process");
const fs = require("fs");
const { resolve } = require("path");
const child_process = require('child_process');

const mAP = require('mean-average-precision');
const mkdirp = require('mkdirp');
const cliProgress = require('cli-progress');

const CONFIG = {
    server: "https://detect.roboflow.com", // or your server IP, eg "http://192.168.4.128:9001"
    workspace: "brad-dwyer",
    model: "egohands-public/5", // your model ID here
    split: "valid", // one of [train, valid, test]; will be pulled from the project on Roboflow
    parallelism: 32, // how many async requests to fire at a time; use 1 to use sequential mode
    api_key: (
        findAndReadFile(".roboflow_key") ||
        process.env.ROBOFLOW_KEY ||
        process.env.ROBOFLOW_API_KEY ||
        "YOUR API KEY HERE"
    ),
    api_endpoint: "https://api.roboflow.com",
    trt: false // set to false unless using the :trt or :trt-jetson dockers which need to be warmed up
};

const outputDir = [__dirname, "datasets", CONFIG.model].join("/");

var images = [];
var buffers = {};

downloadDataset()
.then(prepareData)
.then(warmup).then(function() {
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
        if(!images.length) {
            console.log("No images found, exiting.");
            return resolve();
        }

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
            var predictions = response.data.predictions;

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

function downloadDataset() {
    return new Promise(function(resolve, reject) {
        fs.access(outputDir, function(error) {
            if (error) {
                // directory does not exist; download dataset
                
                axios({
                    method: "GET",
                    url: [CONFIG.api_endpoint, CONFIG.workspace, CONFIG.model, "benchmarker"].join("/"),
                    params: {
                        api_key: CONFIG.api_key
                    }
                }).then(function(response) {
                    mkdirp(__dirname + "/datasets").then(function() {
                        var link = response.data.export.link;
                        console.log("Downloading Dataset...");

                        axios({
                            url: link,
                            method: 'GET',
                            responseType: 'stream' // important
                        }).then(function (response) {
                            var zipFile = [
                                __dirname,
                                "datasets",
                                CONFIG.model.replace("/", "-") + ".zip"
                            ].join("/");
                            const writer = fs.createWriteStream(zipFile);

                            const progressBar = new cliProgress.SingleBar({
                                format: '{bar} | {percentage}% | ETA: {estimate} | {value}/{total} MB'
                            }, cliProgress.Presets.shades_classic);
                            progressBar.start(Math.ceil(response.headers['content-length']/1000000), 0);

                            response.data.pipe(writer);

                            var start = Date.now();

                            var progress = 0;
                            response.data.on('data', function(chunk) {
                                progress += chunk.length;

                                var elapsed = Date.now() - start;
                                var percent = progress / response.headers['content-length'];
                                var speed = percent / elapsed;
                                
                                var secondsLeft = (1 - percent) / speed / 1000;

                                var timeLeft = Math.round(secondsLeft) + "s";
                                if(secondsLeft > 60*60) {
                                    timeLeft = (secondsLeft/60/60).toFixed(1) + " hours";
                                } else if(secondsLeft > 90) {
                                    timeLeft = (secondsLeft/60).toFixed(1) + " minutes";
                                }

                                progressBar.update(Math.floor(progress/1000000), {
                                    estimate: timeLeft
                                });
                            })

                            writer.on("finish", function() {
                                progressBar.update(Math.ceil(response.headers['content-length']/1000000));
                                progressBar.stop();
                                
                                console.log("Unzipping...");
                                mkdirp(outputDir).then(function() {
                                    child_process.execSync(`unzip ${zipFile} -d ${outputDir}; rm ${zipFile}`, { stdio: 'ignore' });
                                    resolve();
                                });
                            });
                        });
                    });
                    
                    // const images = fs.readdirSync("images");
                    // _.each(images, function(path) {
                    //     buffers[path] = fs.readFileSync("images/" + path, {
                    //         encoding: "base64"
                    //     });
                    // });
                    // resolve();
                }).catch(function(error) {
                    console.log("Dataset download failed. Please ensure you have created an export of the dataset using the `Server Benchmark` format.");
                });
            } else {
                // directory already exists... continue
                resolve();
            }
        });
    });
}

function prepareData() {

}