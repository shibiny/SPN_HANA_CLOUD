'use strict';

// Use let to allow testing using rewire
// eslint-disable-next-line prefer-const
let hana_client = require('@sap/hana-client');
const logger = require('./logger');
const {prepareCredentials} = require('./utils');
const {isArray} = require('./utils');
const {enrich_credentials_with_session_variables} = require('./client-info');
const connections = require('./connections');

/**
 * Calls the callback function and logs the error.
 *
 * @param {any} error Error that occured
 * @param {any} callback Callback
 * @returns {undefined}
 */
function could_not_get_status (error, callback) {
  const m = error.message ? error.message : error;
  logger.log(`Could not determine status of last build: ${m}`);
  callback();
}

/**
 * Print the status of the last deployment.
 *
 * @param {any} M_JOBS_RESULT Latest entry from M_JOBS
 * @param {any} M_MESSAGES_RESULT Summary message of latest build.
 * @returns {undefined}
 */
function print_build_status (M_JOBS_RESULT, M_MESSAGES_RESULT) {
  if (isArray(M_JOBS_RESULT)) {
    M_JOBS_RESULT = M_JOBS_RESULT[0];
  }

  if (isArray(M_MESSAGES_RESULT)) {
    M_MESSAGES_RESULT = M_MESSAGES_RESULT[0];
  }

  const status = M_JOBS_RESULT.STATUS;
  const timestamp = M_JOBS_RESULT.JOB_START_TIMESTAMP_UTC;
  const request_id = M_JOBS_RESULT.REQUEST_ID;
  const summary_message = M_MESSAGES_RESULT.MESSAGE;

  logger.log(`Previous build with request ID ${request_id} finished at ${timestamp} with status ${status} and message: ${summary_message}.`);
}

/**
 * Get the status of the last build.
 *
 * @param {any} options Options
 * @param {any} targetCreds Credentials
 * @param {any} callback Callback
 * @returns {undefined}
 */
exports.get = function (options, targetCreds, callback) {
  const hdiCreds = enrich_credentials_with_session_variables(prepareCredentials(targetCreds, options, logger));
  const client = hana_client.createConnection();
  connections.push({client, file: __filename});

  client.connect(hdiCreds, (e) => {
    if (e) {
      return could_not_get_status(e, callback);
    }

    client.exec(`SELECT TOP 1 * from ${targetCreds.schema}#DI.M_JOBS ORDER BY JOB_START_TIMESTAMP_UTC DESC`, (err, r) => {
      if (err) {
        client.disconnect();
        return could_not_get_status(err, callback);
      }

      if (r.length > 0) {
        const latest_request_id = r[0].REQUEST_ID;

        client.exec(`SELECT * from ${targetCreds.schema}#DI.M_MESSAGES where REQUEST_ID = '${latest_request_id}' AND TYPE = 'SUMMARY'`, (error, rows) => {
          if (error) {
            client.disconnect();
            return could_not_get_status(error, callback);
          }
          client.disconnect();
          if (rows.length > 0) {
            print_build_status(r, rows);
            return callback();
          } else {
            return could_not_get_status('Could not find any information about the previous deployment.', callback);
          }
        });
      } else {
        client.disconnect();
        return could_not_get_status('Could not find any information about the previous deployment.', callback);
      }
    });
  });
};
