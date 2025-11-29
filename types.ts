export enum ProviderType {
  GEMINI = 'GEMINI',
  LOCAL = 'LOCAL'
}

export enum CellStatus {
  IDLE = 'IDLE',
  LOADING = 'LOADING',
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR'
}

export interface AppSettings {
  provider: ProviderType;
  localBaseUrl: string;
  localModelName: string;
  geminiModelName: string;
}

export interface CellData {
  id: string;
  value: string;
  status: CellStatus;
  errorMessage?: string;
}

export interface RowData {
  id: string;
  cells: CellData[]; // Index matches column index
}

export interface ColumnHeader {
  id: string;
  label: string;
  systemPrompt: string; // The system prompt used to generate this column's content
  sourceColumnId?: string; // The ID of the column that serves as input for this column
  isInput: boolean; // First column is input, others are generated
}