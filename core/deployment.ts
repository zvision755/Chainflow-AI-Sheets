export type DeploymentMode='server'|'local-docker'|'local-static';
declare const __CHAINFLOW_DEPLOYMENT__:DeploymentMode;
export const deploymentMode:DeploymentMode=typeof __CHAINFLOW_DEPLOYMENT__==='undefined'?'server':__CHAINFLOW_DEPLOYMENT__;
export const browserPersistence=deploymentMode!=='server';
export const staticDeployment=deploymentMode==='local-static';
