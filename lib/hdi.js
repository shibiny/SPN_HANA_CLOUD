'use strict';


const logger = require('./logger.js');
const async = require('async');
const DeployTask = require('./tasks.js');
const {Container} = require('@sap/hdi');
const {enrich_credentials_with_session_variables} = require('./client-info');
const {prepareCredentials} = require('./utils');

const deployId = process.env.DEPLOY_ID || 'Deployment ID: none';

// deploy hdi content
exports.deploy = function (options, creds, content, cb) {
  const hdiCreds = enrich_credentials_with_session_variables(prepareCredentials(creds, options, logger));
  const schema = `${creds.schema}#DI`;
  const container = new Container(creds.schema, hdiCreds, schema);

  const deployTask = new DeployTask(container, hdiCreds, content, options, logger, creds.schema);

  const tasks = [
    ...deployTask.preprocessing(),
    ...deployTask.connect(),
    ...deployTask.lock(),
    ...deployTask.synchronize(),
    ...deployTask.make(),
    ...deployTask.deploy(),
    ...deployTask.unlock()
  ];

  async.series(tasks, function (err, results) {
    if (err) {
      // err.message.replace: delete line breaks
      const message = err.message ? String(err.message) : `${err}`;
      logger.error('Deployment to container %s failed - error: %s [%s].', creds.schema, message.replace(/(\r\n|\n|\r)/gm, ''), deployId);
    } else {
      logger.log('Deployment to container %s done [%s].', creds.schema, deployId);
    }

    // as last action, close the client
    deployTask.disconnect();
    cb(err, {
      task: 'deploy',
      results: results
    });
  });
};
