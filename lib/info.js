'use strict';


/**
 * Get info for the different components.
 *
 * @param {any} components
 * @param {Version} server_version
 * @param {Client_API_Version} container_api_version
 * @param {HDI_Version} hdi_version
 * @returns
 */
function getInfoForComponents (components, server_version, container_api_version, hdi_version) {
  const info = {};

  const all = (components.length === 0) || (components.indexOf('all') !== -1);

  if (all || (components.indexOf('client') !== -1)) {
    const packagejson = require('./../package.json');
    const features_client = require('./features.client.js').getFeatures(server_version, container_api_version, hdi_version);
    info.client = {
      name: packagejson.name,
      version: packagejson.version,
      features: features_client
    };
  }

  if (all || (components.indexOf('server') !== -1)) {
    info.server = {
      name: 'sap-hana-database',
      version: server_version.version,
      'container-api-version': `${container_api_version.version}`,
      'hdi-version': `${hdi_version.version}`,
      features: {}
    };
  }

  return info;
}

module.exports = {
  getInfoForComponents: getInfoForComponents
};
