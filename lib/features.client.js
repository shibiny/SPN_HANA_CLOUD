'use strict';


/**
 * Get the features supported by the client according to the server version.
 *
 * @param {Version} server_version Server version
 * @param {Container_API_Version} container_api_version
 * @param {HDI_Version} hdi_version
 * @returns {Object} feature map
 */
function getFeatures (server_version, container_api_version, hdi_version) {
  const since_server_version_1_0_120_0 = server_version.isGreaterThanOrEqualTo(1, 0, 120, 0) ? 1 : -1;
  const since_server_version_2_0_1_0 = server_version.isGreaterThanOrEqualTo(2, 0, 1, 0) ? 1 : -1;
  const since_server_version_2_0_10_0 = server_version.isGreaterThanOrEqualTo(2, 0, 10, 0) ? 1 : -1;

  const since_container_api_version_44 = container_api_version.isGreaterThanOrEqualTo(44) ? 1 : -1;
  const since_hdi_version_1 = hdi_version.isGreaterThanOrEqualTo(1) ? 1 : -1;
  const since_hdi_version_3 = hdi_version.isGreaterThanOrEqualTo(3);
  const since_hdi_version_10 = hdi_version.isGreaterThanOrEqualTo(10)? 1 : -1;
  const since_hdi_version_1005 = hdi_version.isGreaterThanOrEqualTo(1005)? 1 : -1;

  const since_server_version_2_0_37_1_but_not_higher_sp = server_version.isGreaterThanOrEqualTo(2, 0, 37, 1) && !server_version.isGreaterThanOrEqualTo(2, 0, 40, 0);
  const since_server_version_2_0_24_10_but_not_higher_sp = server_version.isGreaterThanOrEqualTo(2, 0, 24, 10) && !server_version.isGreaterThanOrEqualTo(2, 0, 30, 0);
  const since_server_version_1_0_122_25_but_not_higher_sp = server_version.isGreaterThanOrEqualTo(1, 0, 122, 25) && !server_version.isGreaterThanOrEqualTo(2, 0, 0, 0);
  return {
    'info': 2,
    'verbose': 1,
    'structured-log': 1,
    'lock-container': 1 * since_server_version_2_0_1_0,
    'default-access-role': 1,
    'grants': 4,
    'working-set': 1,
    'include-filter': 1,
    'deploy': 1,
    'treat-unmodified-as-modified': 1,
    'undeploy': 1,
    'parameter': 1 * since_server_version_1_0_120_0,
    'path-parameter': 1 * since_server_version_1_0_120_0,
    'treat-warnings-as-errors': 1 * since_server_version_1_0_120_0,
    'validate-external-dependencies': (since_hdi_version_10 || since_hdi_version_1005),
    'simulate-make': 1 * since_server_version_1_0_120_0,
    'service-replacements': 1,
    'modules': 2,
    'config-templates': 2,
    'environment-options': 1,
    'undeploy-allowlist': 1,
    'zero-downtime-update': 1 * since_server_version_2_0_10_0,
    'treat-wrong-ownership-as-errors': since_container_api_version_44,
    'migrationtable-development-mode': since_hdi_version_1,
    'live-messages': (since_hdi_version_3 || since_server_version_2_0_37_1_but_not_higher_sp || since_server_version_2_0_24_10_but_not_higher_sp || since_server_version_1_0_122_25_but_not_higher_sp) ? 1 : -1
  };
}

module.exports = {
  getFeatures: getFeatures
};
