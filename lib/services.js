'use strict';


const xsenv = require('@sap/xsenv');
const {isArray} = require('./utils');
const shared_password_service = require('./shared-password-service');
/**
 * Returns the reason why the service could not be found by the ServiceAccesor.
 *
 * @param {String} service_name Service name
 * @returns {Number} ID
 */
function why_is_service_not_found (service_name) {
  const filtered_services = xsenv.filterCFServices((service) => service.name === service_name);
  if (filtered_services.length === 0) {
    // No service matches the name!
    return 0;
  } else if ((!filtered_services[0].tags || filtered_services[0].tags.indexOf('hana') === -1) && filtered_services[0].label !== 'user-provided') {
    // Service is missing tags or does not have hana tag, but is not user-provided
    return 1;
  } else if (filtered_services[0].label === 'user-provided' && (!filtered_services[0].credentials.tags || filtered_services[0].credentials.tags.indexOf('hana') === -1 || filtered_services[0].credentials.tags.indexOf('password') === -1)) {
    // Service is user-provided but missing tags/ tag hana/ tag password in credentials.
    return 2;
  }
}

/**
 * Throw an error message if the service could not be found with details why it could not be found.
 *
 * @param {String} service_name Name of the service.
 * @param {String} replacement_service_name Name of the replacement service. Optional.
 *
 * @returns {undefined}
 */
function get_service_not_found_error (service_name, replacement_service_name) {
  let reason;
  const error_message_suffix = {
    0: 'not found; the service definition does not exist.',
    1: "not found; the service is not tagged with the tag 'hana'",
    2: "not found; the service is user-provided, but is missing the tag 'hana' or the tag 'password' in the credentials properties."
  };

  if (replacement_service_name) {
    reason = why_is_service_not_found(replacement_service_name);
    return new Error(`service ${replacement_service_name} as replacement for service ${service_name} ${error_message_suffix[reason]}`);
  } else {
    reason = why_is_service_not_found(service_name);
    return new Error(`service ${service_name} ${error_message_suffix[reason]}`);
  }
}

/**
 * Find a hdi-service in the given services and return it.
 *
 * @param {Array} services Array of services
 * @returns {Object} The hdi-service.
 * @throws {Error} Throws if no service found or more than one.
 */
function find_hdi_service_or_throw (services) {
  /**
   * Check if the given service is a hdi service.
   *
   * @param {Object} service Service to check.
   * @returns {Boolean} True or false.
   */
  function is_hdi (service) {
    return (service.plan === 'hdi-shared' || service.credentials.hdi_user);
  }

  const hdi_services = services.filter(is_hdi);

  if (hdi_services.length === 0) {
    throw new Error('No HDI service found!');
  } else if (hdi_services.length > 1) {
    throw new Error('More than one HDI service found, but no service is defined as the deployment target via the environment variable "TARGET_CONTAINER"');
  } else {
    return hdi_services[0];
  }
}

/**
 * Class to handle working with services.
 *
 * @returns {ServiceAccessor} An instance of ServiceAccessor
 */
function ServiceAccessor () {
  this.services = xsenv.filterCFServices(function (service) {
    if (service.tags && ((Array.isArray(service.tags) && service.tags.includes('hana')) || service.tags === 'hana')) {
      return true;
    }
    if (service.label === 'user-provided' && service.credentials.tags && ((Array.isArray(service.credentials.tags) && (service.credentials.tags.includes('hana')) || service.credentials.tags === 'hana') || ((Array.isArray(service.credentials.tags) && service.credentials.tags.includes('password')) || service.credentials.tags === 'password'))) {
      return true;
    }
    return false;
  });

  // read service replacements from environment and store them in serviceReplacements
  this.serviceReplacements = {};
  this.getServiceReplacements = function () {
    return this.serviceReplacements;
  };

  this.useServiceReplacements = false;
  this.usingServiceReplacements = function () {
    return this.useServiceReplacements;
  };

  if (typeof process.env.SERVICE_REPLACEMENTS !== 'undefined') {
    let serviceReplacementsFromEnv = [];
    try {
      serviceReplacementsFromEnv = JSON.parse(process.env.SERVICE_REPLACEMENTS);
    } catch (error) {
      throw new Error(`Failed to parse JSON object in SERVICE_REPLACEMENTS: ${error}`);
    }
    if (!Array.isArray(serviceReplacementsFromEnv)) {
      throw new Error('Failed to parse JSON object in SERVICE_REPLACEMENTS: SERVICE_REPLACEMENTS must be an array');
    }
    for (let i = 0; i < serviceReplacementsFromEnv.length; ++i) {
      if (!serviceReplacementsFromEnv[i].key) {
        throw new Error(`Failed to parse JSON object in SERVICE_REPLACEMENTS: SERVICE_REPLACEMENTS does not define a key for element ${i}`);
      }
      if (!serviceReplacementsFromEnv[i].service) {
        throw new Error(`Failed to parse JSON object in SERVICE_REPLACEMENTS: SERVICE_REPLACEMENTS does not define a service for element ${i}`);
      }
      if (this.serviceReplacements.hasOwnProperty(serviceReplacementsFromEnv[i].key)) {
        throw new Error(`Failed to parse JSON object in SERVICE_REPLACEMENTS: SERVICE_REPLACEMENTS contains duplicate entries for the key ${serviceReplacementsFromEnv[i].key}`);
      }
      this.serviceReplacements[serviceReplacementsFromEnv[i].key] = serviceReplacementsFromEnv[i];
    }

    this.useServiceReplacements = true;
  }

  // internal function which returns the bound service with the given name, or null if not found
  this.getServiceInternal = function (serviceName) {
    for (let i = 0; i < this.services.length; i = i + 1) {
      if (this.services[i].name === serviceName) {
        return this.services[i];
      }
    }
    return null;
  };

  // returns the bound service with the given name, throws an error if not found
  this.getServiceOrThrow = function (serviceName) {
    const service = this.getServiceInternal(serviceName);
    if (service === null) {
      throw get_service_not_found_error(serviceName);
    }
    return service;
  };

  // returns the bound service with the given name using the service replacements map, throws an error if not found
  this.getServiceUsingServiceReplacements = function (serviceName) {
    const service = (() => {
      if (this.serviceReplacements.hasOwnProperty(serviceName)) {
        // look up real service name via replacement map
        const realServiceName = this.serviceReplacements[serviceName].service;
        // get the real service
        const service = this.getServiceInternal(realServiceName);
        if (service === null) {
          throw get_service_not_found_error(serviceName, realServiceName);
        }
        return service;
      } else {
        // service name is not mapped via replacement map, directly get the real service
        return this.getServiceOrThrow(serviceName);
      }
    })();

    if (service.credentials && (isArray(service.credentials.password) || isArray(service.credentials.hdi_password))) {
      return shared_password_service.build(service, this);
    }

    return service;
  };

  // returns the service which represents the target container
  this.getTarget = function () {
    if (process.env.TARGET_CONTAINER) {
      return this.getServiceOrThrow(process.env.TARGET_CONTAINER);
    }

    switch (this.services.length) {
    case 0:
      throw new Error('no service definition found; there must be at least one service definition for the deployment target');
    case 1:
      return this.services[0];
    default:
      return find_hdi_service_or_throw(this.services);
    }
  };

  this.getTargetCreds = function () {
    const target = this.getTarget();
    return target ? target.credentials : null;
  };

  this.getCreds = function (serviceName) {
    return this.getServiceUsingServiceReplacements(serviceName).credentials;
  };

  this.getService = this.getServiceUsingServiceReplacements;
}

module.exports = function () {
  return new ServiceAccessor();
};
