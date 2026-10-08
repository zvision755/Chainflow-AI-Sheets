export function localTextModels(models:string[]):string[] {
  return models.filter(model=>!/(?:embed|embedding|rerank)/i.test(model));
}

export function invalidLocalModels(models:string[],available:string[]):string[] {
  const valid=new Set(localTextModels(available));
  return models.filter(model=>!valid.has(model));
}

export function reconcileLocalColumnModels<T extends {id:string;model:string}>(columns:T[],available:string[]):Array<T & {model:string}> {
  const textModels=localTextModels(available),defaultModel=textModels[0];
  if(!defaultModel)return columns;
  return columns.map(column=>textModels.includes(column.model)?column:{...column,model:defaultModel});
}
