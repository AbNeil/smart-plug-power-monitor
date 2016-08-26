'use strict';

const Hs100Api = require('hs100-api'); //Smart Plug, for monitoring power usage
const IFTTTmaker = require('node-ifttt-maker'); //IFTTT, for sending notifications

class WattsMeter {
    constructor(options) {

        this.config = {
          iftttMakerChannelKey: "", //REQUIRED from https://ifttt.com/maker
          smartPlugIP: "", //REQUIRED example: 192.168.1.5
          pollIntervalSeconds: 2, //how often to check wattage
          networkRetryIntervalSeconds: 120, //how often to poll if the smart plug IP address is not reachable
          startEventName: 'appliance-started', //IFTTT maker event name
          endEventName: 'appliance-completed', //IFTTT maker event name
          wattsThreshold: 10, //wattage above this value will trigger start event
          startTimeWindowSeconds: 5, //if wattage is exceeded for this period, appliance is considered started
          endTimeWindowSeconds: 10, //if wattage is below threshold for this entire period, appliance is considered completed running
          cooldownPeriodSeconds: 20, //wait this long after end event before responding to subsequent start events, set to same as poll interval if no cooldown is needed
          pollingCallback: (powerConsumption)=>{}, //returns the power consumption data on every polling interval
          eventCallback: (event, data)=>{} //called when appliance starts and stops
        };

        Object.assign(this.config, options);

        this.timer;
        this.applianceRunning = false;
        this.elapsedRuntime = 0;
        this.overWattsThresholdStartTime;
        this.underWattsThresholdStartTime;
        this.lastEndTime;

        //check for required options
        this.valid = true;
        if (!this.config.smartPlugIP || typeof this.config.smartPlugIP !== 'string') {
          this.valid = false;
          throw new Error('smartPlugIP (string) is missing from options.  Provide the IP Address of your TP-Link HS110.');
        }
        if (!this.config.iftttMakerChannelKey || typeof this.config.iftttMakerChannelKey !== 'string') {
          this.valid = false;
          throw new Error('iftttMakerChannelKey (string) is missing from options.  Get one here: https://ifttt.com/maker');
        }

        this.smartPlug = new Hs100Api({host: this.config.smartPlugIP});
        this.iftttMarkerChannel = new IFTTTmaker(this.config.iftttMakerChannelKey);
    }

    start(){
      if(!this.valid){
        throw new Error('Unable to start listening due to invalid configuration options.');
      }else{
        this.test();
      }
    }

    stop(){
      console.log('stop');
    }

    test(){
      let self = this;
      console.log('try get consumption');
      try{
        this.smartPlug.getConsumption()
          .then(function(smartPlugData){
            console.log('then');
            console.dir(this);
            console.dir(arguments);
            console.dir(smartPlugData);
            let consumptionData = smartPlugData.get_realtime;
            self.config.pollingCallback(consumptionData);
            let wattage = consumptionData.power;
            self._evaluateWattage(wattage);
          })
          .catch(function(err){
            //smart plug unreachable
            console.log('CATCH smart plug unreachable');
            self.config.eventCallback('Smart plug IP address unreachable.', err);
            self.timer = setTimeout(()=>{self.test()}, self.config.networkRetryIntervalSeconds);
          });
      } catch(e){
        console.dir(e);
      }

    }

    _evaluateWattage(wattage){
      //console.dir(this);
      var now = new Date();
      var applianceJustFinished = false;
      //if above wattage threshold
      if(wattage > this.config.wattsThreshold){
        //reset under watts time
        this.underWattsThresholdStartTime = null;
        //record start time of watts exceeded
        if(!this.overWattsThresholdStartTime){
          this.overWattsThresholdStartTime = new Date();
        }

        this.elapsedRuntime = now - this.overWattsThresholdStartTime;

        //detect if appliance running for longer than start time window
        if(!this.applianceRunning && this.elapsedRuntime > this.config.startTimeWindowSeconds * 1000){
          //appliance started
          this.applianceRunning = true;
          this.sendNotification(this.config.startEventName);
        }

      }else if(this.applianceRunning){
        //below watts threshold and appliance running
        if(!this.underWattsThresholdStartTime){
          this.underWattsThresholdStartTime = new Date();
        }

        //elapsed time of watts not exceeded
        var elapsed = now - this.underWattsThresholdStartTime;
        if(elapsed > this.config.endTimeWindowSeconds * 1000){
          //appliance completed
          this.applianceRunning = false;
          this.sendNotification(this.config.endEventName, {elapsed: elapsed});
          this.lastEndTime = now;
          //reset start time
          this.overWattsThresholdStartTime = null;
        }

      }

      if(this.lastEndTime == now){
        //if appliance running just ended, poll wattage after cooldown period
        setTimeout(()=>{this.test()}, this.config.cooldownPeriodSeconds*1000);
      }else{
        //otherwise poll at usual polling interval
        setTimeout(()=>{this.test()}, this.config.pollIntervalSeconds*1000);
      }

    }

    sendNotification(eventName, data){
      this.config.eventCallback(eventName, data);
      var params = {};

      if(data && typeof data.elapsed != 'undefined'){
        var elapsedMinutes = (data.elapsed/1000/60).toFixed(1);
        params.value1 = elapsedMinutes;
      }

      //console.log('params', params);
      /*
      iftttMarkerChannel.request({
          event: eventName,
          method: 'GET',
          params: params
      }, function (err) {
          if (err) {
            new Error('Failed to send IFTTT notification '+eventName, err);
          } else {
            //sent notification
          }
      });
      */
    }

}



module.exports = WattsMeter;
