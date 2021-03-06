'use strict';
const hana_client = require('@sap/hana-client');
const hana_helper = require('./hana-helper.js');
const logger = require('./logger');
const connections = require('./connections');

const printMessages = hana_helper().printMessages;
/**
 * Log the messages.
 *
 * @param {any} messages The messages to log.
 * @param {any} logger Logging utility.
 * @returns {undefined} No return value.
 */
function logfn (messages) {
  printMessages(logger, messages);
}
/**
 * Class that handles the polling for make messages.
 *
 * @class Poller
 */
class Poller {
  /**
   * Creates an instance of Poller.
   *
   * @memberOf Poller
   */
  constructor (connection_id, schema, db_credentials) {
    this.last_row_id = 0;
    this.stop_flag = false;

    /**
     * Get the request_id by using the connection_id in M_JOBS. Need to poll, since we don't know, when the make has "hit the db".
     *
     * @param {any} connection_id
     * @param {any} schema
     * @param {any} db
     * @param {any} cb
     * @returns
     */
    const poll_request_id = (connection_id, schema, db, cb) => {
      if (this.stop_flag) {
        return cb();
      }
      const sql = `SELECT REQUEST_ID FROM "${schema}#DI".M_JOBS WHERE CONNECTION_ID=${connection_id};`;
      /**
       * Callback for tail recursion
       *
       * @param {any} err
       * @param {any} results
       * @returns
       */
      const poll_callback = (err, results) => {
        if (this.stop_flag) {
          return cb();
        }
        if (err) {
          this.stop_flag = true;
          logger.warn('Encountered an error during polling for messages. Polling will be stopped.');
          return cb();
        }

        if (results && results.length === 1) {
          return cb(results[0].REQUEST_ID);
        }

        return setTimeout(() => db.exec(sql, poll_callback), 500);
      };

      db.exec(sql, poll_callback);
    };

    /**
     * Poll the messages for the currently running make
     *
     * @param {any} request_id
     * @param {any} schema
     * @param {any} db
     */
    const poll_messages = (request_id, schema, db) => {
      logger.log(`Polling messages for request id: ${request_id}`);
      if (this.stop_flag) {
        return;
      }
      request_id = parseInt(request_id);
      let row_id = -1;
      let statement;

      /**
       * Poll the messages and print them - Calls itself recursively
       */
      const poll_callback = (err, result_messages) => {
        if (this.stop_flag) {
          return;
        }
        if (err) {
          this.stop_flag = true;
          logger.warn('Encountered an error during polling for messages. Polling will be stopped.');
          return;
        }

        if (result_messages && result_messages.length) {
          logfn(result_messages);
          row_id = result_messages[result_messages.length - 1].ROW_ID;
          this.last_row_id = row_id;
        }

        return setTimeout(() => statement.exec([request_id, row_id], poll_callback), 1000);
      };

      const sql = `SELECT * FROM "${schema}#DI".M_MESSAGES WHERE REQUEST_ID = ? AND ROW_ID > ? ORDER BY ROW_ID;`;
      db.prepare(sql, (err, prep_statement) => {
        if (err) {
          return poll_callback(err);
        }
        statement = prep_statement;
        statement.exec([request_id, row_id], poll_callback);
      });
    };

    this.start_polling = () => {
      if (!connection_id) {
        // Return, since without connection_id, no polling is possible.
        return;
      }
      try {
        const db = hana_client.createConnection();
        connections.push({client:db, file: __filename});
        db.connect(db_credentials, (e) => {
          if (e) {
            this.stop_flag = true;
            logger.warn('Encountered an error during polling for messages. Polling will be stopped.');
          } else {
            this.db = db;
            poll_request_id(connection_id, schema, db, (request_id) => {
              if (request_id) {
                poll_messages(request_id, schema, db);
              }
            });
          }
        });
      } catch (e) {
        this.stop_flag = true;
        logger.warn('Encountered an error during polling for messages. Polling will be stopped.');
      }
    };
  }

  /**
   * Stop the polling and return the last row id.
   *
   * @returns {String} Last row id
   *
   * @memberOf Poller
   */
  stop_polling () {
    this.stop_flag = true;
    if (this.db) {
      this.db.disconnect();
    }
    return this.last_row_id;
  }
}

/**
 * Class that wraps the make call to keep our state information etc "close"
 *
 * @class Make_Task
 */
class Make_Task {
  /**
   * Creates an instance of Make_Task.
   * @param {any} deployFiles
   * @param {any} undeployFiles
   * @param {any} pathParameters
   * @param {any} deployParameters
   * @param {any} container
   * @param {any} hdiCreds
   * @param {any} schema
   *
   * @memberOf Make_Task
   */
  constructor (connection_id, container, hdiCreds, schema) {
    this.poller = new Poller(connection_id, schema, hdiCreds);
    this.container = container;
  }

  /**
   * Run the make, call the callback with errors, results and the last row id
   *
   * @param {any} callback
   *
   * @memberOf Make_Task
   */
  make (deployFiles, undeployFiles, pathParameters, parameters, callback) {
    this.container.make(deployFiles, undeployFiles, pathParameters, parameters, (e, results) => {
      const last_row_id = this.poller.stop_polling();
      callback(e, {results, last_row_id});
    });
    this.poller.start_polling();
  }
}

module.exports = Make_Task;
