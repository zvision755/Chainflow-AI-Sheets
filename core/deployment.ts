export type DeploymentMode='server'|'web';
declare const __CHAINFLOW_DEPLOYMENT__:DeploymentMode;
export const deploymentMode:DeploymentMode=typeof __CHAINFLOW_DEPLOYMENT__==='undefined'?'server':__CHAINFLOW_DEPLOYMENT__;
export const browserPersistence=deploymentMode==='web';
export const staticDeployment=browserPersistence;
