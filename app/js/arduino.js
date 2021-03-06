var serialPort = require('serialport');
var SerialPort = require('serialport').SerialPort;
var pManager = require('../js/afm_session_manager.js');
var EventEmitter = require('events').EventEmitter;
var emitter = new EventEmitter();
var arduino;
var connection;
var COM;
var currentSession;
var DONE;
var currentLine = '';
var readyCount;
var lineLength = 256;
var STOP = true;
var SCANNING = false;
var receiveCount = 0;
var scale_factor = 1;
var scale_offset = 0;

function findBoard(cb) {
  var last = false;
  serialPort.list(function (err, ports) {
    // check ports on computer
    ports.forEach(function(port, i) {
      if (i == ports.length - 1){
        last = true;
      }
 
      COM = port.comName;
      // check to see if arduino plugged in and open connection
      if ((COM.search('cu.usbmodem') != -1) ||
          (COM.search('cu.wchusbserial') != -1) ||
          (COM.search('tty.usbmodem') != -1) ||
          (COM.search('cu.usbserial') != -1) ||
          (COM.search('COM')) != -1) {
        arduino = port;
        connection = new SerialPort(arduino.comName, {
          baudrate: 9600
        }, false);

        connection.open(function (error) {
          if ( error ) {
            console.log('failed to open: '+ error);
          } else {
            console.log('Arduino ready!');
            cb(true);
          }
        });
      } else {
        if (last === true){
          console.log('Arduino not found!');
          cb(false);
        }
      }
    });
  });
}

function checkBoard(cb) {
  var last = false;
  serialPort.list(function (err, ports) {
    // check ports on computer
    ports.forEach(function(port, i, stop) {
      if (i == ports.length - 1){
        last = true;
      }
      COM = port.comName;
      // check to see if arduino plugged in and open connection
      if ((COM.search('cu.usbmodem') != -1) ||
          (COM.search('cu.wchusbserial') != -1) ||
          (COM.search('tty.usbmodem') != -1) || 
          (COM.search('cu.usbserial') != -1) ||
          (COM.search('COM') != -1)) {
        cb(true);
      } else {
        if (last === true) {
          connection.close(function (error) {
            cb(false);
          });
        }
      }
    });
  });
}

function startScan(name) {
  //clear the plots...this clears but also need to reset something in left chart
  ['leftImage', 'rightImage', 'leftChart', 'rightChart'].forEach(function(id) {
    document.getElementById(id).innerHTML = '';
  });
  emitter.emit('clearPlots');
  
  SCANNING = true;
  STOP = false;
  DONE = false;
  readyCount = 0;
  var session = pManager.newSession(name);
  currentSession = session;
  console.log('Attempting scan initialisation.');
  connection.write('GO;', function(){
    receiveData();
  });
}

function receiveData() {
  //each time new serial data is received
  connection.on('data', function(data){
    if (SCANNING === true) {
      //console.log('Serial data received: ' + data);
      data = '' + data;
      parseData(data);
    } else {
      connection.write('DONE;');
    }
  });
}

function parseData(data) { 
  //semi is the position of the first semi colon in data (-1 if none)
  var semi = data.search(';');

  // if there is no semi colon in data
  if (semi == -1) {
    //console.log("No semicolon in data");
    // data is just part of a message
    //add it to the currently recording line 
    currentLine = currentLine + data;
  }
  // if data does contain a semicolon 
  else {
    var len = data.length;
    //if the first semi is at the end of data
    if (semi == len - 1) {
      //data is the end of a message 
      //so add it to line and read it
      currentLine = currentLine + data  
      readLine(currentLine, function() {
        currentLine = '';
      });
    } 
    else {
      //take upto(including) and after the semi
      var startData = data.slice(0, semi + 1);
      var endData = data.slice(semi + 1, len);
      //add the first part to the line and read it
      currentLine = currentLine + startData;
      readLine(currentLine, function() {
        currentLine = '';
        parseData(endData);
      });          
    }
  }
}

function readLine(line, cb) {
  //line can be: GO; RDY; DONE; or actual datas
  if (line == 'GO;') {
    console.log('Go received.');
    currentLine = '';
    connection.write('RDY;');
    readyCount += 1;
    console.log('Scan started.');
  } else if (line == 'RDY;') {
    //do nothing, real data in next line
  } else if (line == 'DONE;'){
    //set flag for final data in next line
    DONE = true;
  } else {
    //this is a line of data. maybe check its length?
    //then plot and save it
    //actually lets drop that semi
    line = line.slice(0, (line.length - 1))
    plotData(line, function() {
      saveData(line, function() {
        // either bring the scan to an end or continue it
        checkFinished();
      });
    });
  }
  cb()
}

function checkFinished() {
  if (DONE === true) {
    console.log('All data received, terminating session');
    if (currentSession.data.length == lineLength * lineLength * 2) {
      console.log('Image dataset looks good.');
    } else {
      console.log('Image dataset length does noot look correct. Length: ' + currentSession.data.length);
    }
    endScan();
  } else{
    //if that was the penultimate line
    if (readyCount == 255) {
      console.log('This was the penultimate line, preparing to terminate session');
      connection.write('DONE;');
      DONE = true;
    } else {
      console.log('Data processed, proceeding');
      connection.write('RDY;');
      readyCount += 1;
      console.log('Sent ready command ' + readyCount + ', waiting for new line');
      console.log('...');
    }
  }
}

function setContrast(scale, offset){
  scale_factor = parseFloat(scale);
  scale_offset = parseFloat(offset);
  console.log('Contrast set.');
}

//hack to fix reversed colours in plot - send them reversed data!
function reverseAndScale(set, max){
  console.log('Received data from arduino:', set.slice(0,5));
  set.forEach(function(n, i) {
    set[i] = ((scale_factor * (max - n)) + scale_offset);
    //if some data is no good 
    if (isNaN(set[i])) {
      console.log('Bad datapoint at pos ', i, ': ', set[i])
      set[i] = 666
    }
  });
  console.log('SF: ', scale_factor, 'Of: ', scale_offset, 'Result: ', set.slice(0,5))
}

function plotData(lineStr, cb){
  var lineForward = lineStr.split(',').slice(0, lineLength);
  var lineBack = lineStr.split(',').slice(lineLength, lineStr.length);
  reverseAndScale(lineForward, 2047);
  reverseAndScale(lineBack, 2047);
  var line = [];
  line.push(lineForward);
  line.push(lineBack);
  console.log('Attempting to emit data to plot.');
  emitter.emit('line', line);
  emitter.once('plotted', function() {
    console.log('Received plotted confirmation, continuing');
    cb(); 
  });
}



function saveData(data, cb) {
  var dataArray = data.split(',');
  function appendCb(dataArray, cb) {
    dataArray.forEach(function(point) {
      if (parseInt(point, 10) === null) {
        console.log('Got null datapoint: ' + point);
        currentSession.data.push(666);
      } else {
        currentSession.data.push(parseInt(point, 10));
      }
    });
    cb();
  } 
  if (dataArray.length == lineLength * 2) {
    console.log('Data length correct!');
    appendCb(dataArray, cb);
  } else {
    console.log('Error: Data length incorrect, cancelling scan! Data' + dataArray);
    endScan();
  }
}

function endScan() {
  if (DONE == false) {
    connection.write('DONE;');
  }
  STOP = true;
  emitter.emit('end');

  if (currentSession) {
    pManager.endSession(currentSession, function() {
      currentSession = null;
    });
  }
  SCANNING = false;
}

function scanKilled() {
  console.log('Arduino disconnected! Ending scan...')
  connection.close( function (error) {} );
  if (currentSession) {
    pManager.endSession(currentSession, function() {
      currentSession = null;
    });
  }
  SCANNING = false;
}

module.exports = {
  findBoard: findBoard,
  checkBoard : checkBoard,
  emitter : emitter,
  startScan : startScan,
  endScan : endScan,
  setContrast: setContrast,
  scanKilled: scanKilled
};
