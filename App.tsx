import React, { useState, useCallback, useEffect } from 'react';
import { Plus, Trash2, RefreshCw, AlertCircle, Settings as SettingsIcon, Sparkles, Link as LinkIcon, ArrowRight } from 'lucide-react';
import { 
  AppSettings, 
  CellData, 
  CellStatus, 
  ColumnHeader, 
  ProviderType, 
  RowData 
} from './types';
import { generateContent } from './services/llmService';
import { SettingsModal } from './components/SettingsModal';

// --- Constants ---
const DEFAULT_ROWS = 3;

// --- Helper Components ---

const StatusIndicator: React.FC<{ status: CellStatus; error?: string }> = ({ status, error }) => {
  switch (status) {
    case CellStatus.LOADING:
      return <RefreshCw className="w-4 h-4 text-blue-500 animate-spin" />;
    case CellStatus.ERROR:
      return (
        <div className="group relative">
          <AlertCircle className="w-4 h-4 text-red-500 cursor-help" />
          <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-48 bg-red-800 text-white text-xs p-2 rounded shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
            {error || 'An error occurred'}
          </div>
        </div>
      );
    case CellStatus.SUCCESS:
      return <span className="w-2 h-2 rounded-full bg-green-500 block" />;
    default:
      return <span className="w-2 h-2 rounded-full bg-gray-300 block" />;
  }
};

const App: React.FC = () => {
  // --- State ---
  const [settings, setSettings] = useState<AppSettings>({
    provider: ProviderType.GEMINI,
    localBaseUrl: 'http://localhost:11434',
    localModelName: 'llama3',
    geminiModelName: 'gemini-2.5-flash',
  });

  const [headers, setHeaders] = useState<ColumnHeader[]>([
    { id: 'col-0', label: 'User Input', systemPrompt: '', isInput: true },
    { id: 'col-1', label: 'Step 1 Output', systemPrompt: 'Summarize the input in one sentence.', sourceColumnId: 'col-0', isInput: false },
    { id: 'col-2', label: 'Step 2 Output', systemPrompt: 'Translate the summary to French.', sourceColumnId: 'col-1', isInput: false },
  ]);

  const [rows, setRows] = useState<RowData[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // --- Initialization ---
  useEffect(() => {
    // Initialize with empty rows
    const initRows = Array.from({ length: DEFAULT_ROWS }).map((_, i) => ({
      id: `row-${Date.now()}-${i}`,
      cells: Array.from({ length: 3 }).map((_, j) => ({
        id: `cell-${i}-${j}`,
        value: '',
        status: CellStatus.IDLE,
      })),
    }));
    setRows(initRows);
  }, []);

  // --- Logic ---

  // Update a single cell's data in the state
  const updateCell = useCallback((rowId: string, colIndex: number, updates: Partial<CellData>) => {
    setRows((prevRows) =>
      prevRows.map((row) => {
        if (row.id !== rowId) return row;
        const newCells = [...row.cells];
        if (newCells[colIndex]) {
          newCells[colIndex] = { ...newCells[colIndex], ...updates };
        }
        return { ...row, cells: newCells };
      })
    );
  }, []);

  /**
   * Executes the generation for a specific target cell.
   * @param rowId The row ID
   * @param targetColIndex The index of the column to generate content for
   * @param directInputVal Optional. If provided, uses this string as input instead of looking up the source column in state. 
   *                       This prevents race conditions during chained updates.
   */
  const executeGeneration = useCallback(async (rowId: string, targetColIndex: number, directInputVal?: string) => {
    const targetHeader = headers[targetColIndex];
    if (!targetHeader || targetHeader.isInput) return;

    // 1. Determine Source Value
    let sourceValue = directInputVal;

    // If direct input wasn't provided (e.g. manual regeneration), look it up from state
    if (sourceValue === undefined) {
      const sourceColId = targetHeader.sourceColumnId;
      const sourceColIndex = headers.findIndex(h => h.id === sourceColId);
      
      if (sourceColIndex === -1) {
        updateCell(rowId, targetColIndex, { status: CellStatus.ERROR, errorMessage: "Source column configuration invalid." });
        return;
      }

      const row = rows.find(r => r.id === rowId);
      if (!row) return;
      sourceValue = row.cells[sourceColIndex]?.value || '';
    }

    // If source is empty, do nothing (or clear?)
    if (!sourceValue.trim()) return;

    // 2. Set Status Loading
    updateCell(rowId, targetColIndex, { status: CellStatus.LOADING, errorMessage: undefined });

    try {
      // 3. Call API
      const result = await generateContent(targetHeader.systemPrompt, sourceValue, settings);
      
      // 4. Update Success
      updateCell(rowId, targetColIndex, { 
        value: result, 
        status: CellStatus.SUCCESS 
      });

      // 5. Recursive Chain: Find columns that depend on THIS column
      const dependents = headers
        .map((h, index) => ({ ...h, index }))
        .filter(h => h.sourceColumnId === targetHeader.id);

      dependents.forEach(dep => {
        executeGeneration(rowId, dep.index, result);
      });

    } catch (error: any) {
      updateCell(rowId, targetColIndex, { 
        status: CellStatus.ERROR, 
        errorMessage: error.message 
      });
    }
  }, [headers, rows, settings, updateCell]);


  // Handle User Input Change (Column 0) OR Manual Edit of any cell
  const handleCellChange = (rowId: string, colIndex: number, newValue: string) => {
    updateCell(rowId, colIndex, { value: newValue, status: CellStatus.IDLE });
  };

  // When a cell is blurred, we check if any other columns depend on this one and trigger them.
  const handleCellBlur = (rowId: string, colIndex: number, value: string) => {
    const currentHeader = headers[colIndex];
    
    // Find all columns that utilize this column as a source
    const dependents = headers
      .map((h, index) => ({ ...h, index }))
      .filter(h => h.sourceColumnId === currentHeader.id);
    
    // Trigger them
    dependents.forEach(dep => {
      // We pass the 'value' directly to ensure the dependent uses the latest text
      // even if React state hasn't fully flushed yet.
      executeGeneration(rowId, dep.index, value);
    });
  };

  const handleHeaderChange = (index: number, field: keyof ColumnHeader, value: string) => {
    setHeaders(prev => {
      const newHeaders = [...prev];
      newHeaders[index] = { ...newHeaders[index], [field]: value };
      return newHeaders;
    });
  };

  const addRow = () => {
    setRows(prev => [
      ...prev,
      {
        id: `row-${Date.now()}`,
        cells: headers.map((_, i) => ({
          id: `cell-${Date.now()}-${i}`,
          value: '',
          status: CellStatus.IDLE
        }))
      }
    ]);
  };

  const removeRow = (rowId: string) => {
    setRows(prev => prev.filter(r => r.id !== rowId));
  };

  const addColumn = () => {
    const newId = `col-${Date.now()}`;
    // Default source is the immediately preceding column
    const defaultSourceId = headers[headers.length - 1]?.id;

    setHeaders(prev => [
      ...prev,
      { 
        id: newId, 
        label: `Step ${prev.length}`, 
        systemPrompt: 'New system instruction...', 
        sourceColumnId: defaultSourceId,
        isInput: false 
      }
    ]);
    
    // Add empty cells to all rows for the new column
    setRows(prev => prev.map(row => ({
      ...row,
      cells: [...row.cells, { id: `cell-${row.id}-${headers.length}`, value: '', status: CellStatus.IDLE }]
    })));
  };

  const removeColumn = (index: number) => {
    if (index === 0) return; // Cannot remove input column
    setHeaders(prev => prev.filter((_, i) => i !== index));
    setRows(prev => prev.map(row => ({
      ...row,
      cells: row.cells.filter((_, i) => i !== index)
    })));
  };

  const regenerateCell = (rowId: string, colIndex: number) => {
    executeGeneration(rowId, colIndex);
  };

  // --- Render ---

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Top Bar */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between shadow-sm z-10">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-600 rounded-lg shadow-indigo-200 shadow-md">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-800 tracking-tight">ChainFlow AI Sheets</h1>
            <p className="text-xs text-gray-500">
              Using {settings.provider === ProviderType.GEMINI ? 'Gemini AI' : 'Local LLM'}
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setIsSettingsOpen(true)}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-all hover:border-gray-300"
          >
            <SettingsIcon className="w-4 h-4" />
            Settings
          </button>
        </div>
      </header>

      {/* Main Grid Area */}
      <main className="flex-1 overflow-auto relative">
        <div className="min-w-max p-6 pb-20"> {/* pb-20 for room for Add Row button */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="w-12 bg-gray-50 border-b border-r border-gray-200"></th>
                  {headers.map((header, index) => (
                    <th key={header.id} className="w-80 min-w-[300px] bg-gray-50 border-b border-r border-gray-200 last:border-r-0 p-0 align-top">
                      <div className="p-3 border-b border-gray-100 flex flex-col gap-2 group">
                        
                        {/* Header Top Row: Label & Delete */}
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            {header.isInput ? (
                              <div className="font-semibold text-gray-700 text-sm">{header.label}</div>
                            ) : (
                              <input
                                type="text"
                                value={header.label}
                                onChange={(e) => handleHeaderChange(index, 'label', e.target.value)}
                                className="font-semibold text-gray-700 text-sm bg-transparent border-none p-0 focus:ring-0 w-full"
                              />
                            )}
                          </div>
                          {!header.isInput && (
                            <button 
                              onClick={() => removeColumn(index)}
                              className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity ml-2"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                        
                        {/* Configuration Area */}
                        {!header.isInput ? (
                            <div className="space-y-2">
                                {/* Source Selector */}
                                <div className="flex items-center gap-2 bg-gray-100 rounded px-2 py-1">
                                    <LinkIcon className="w-3 h-3 text-gray-400" />
                                    <span className="text-[10px] uppercase font-bold text-gray-400">Input:</span>
                                    <select 
                                        value={header.sourceColumnId || ''}
                                        onChange={(e) => handleHeaderChange(index, 'sourceColumnId', e.target.value)}
                                        className="bg-transparent text-xs text-gray-700 font-medium outline-none flex-1 border-none p-0 focus:ring-0 cursor-pointer"
                                    >
                                        <option value="" disabled>Select Source</option>
                                        {headers.map(h => (
                                            h.id !== header.id && (
                                                <option key={h.id} value={h.id}>
                                                    {h.label}
                                                </option>
                                            )
                                        ))}
                                    </select>
                                </div>

                                {/* System Prompt */}
                                <textarea
                                  value={header.systemPrompt}
                                  onChange={(e) => handleHeaderChange(index, 'systemPrompt', e.target.value)}
                                  placeholder="Enter System Prompt here..."
                                  className="w-full text-xs text-gray-600 bg-white border border-gray-200 rounded p-2 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 outline-none resize-none h-16 shadow-sm placeholder:text-gray-300"
                                />
                            </div>
                        ) : (
                            <div className="h-[104px] flex items-center text-xs text-gray-400 italic bg-gray-50/50 rounded p-2 border border-dashed border-gray-200">
                              Start typing in the rows below to trigger the chain.
                            </div>
                        )}
                      </div>
                    </th>
                  ))}
                  <th className="w-12 bg-gray-50 border-b border-gray-200 p-2 text-center align-middle">
                    <button 
                      onClick={addColumn}
                      className="p-1.5 hover:bg-gray-200 rounded-full text-gray-500 transition-colors"
                      title="Add Column"
                    >
                      <Plus className="w-5 h-5" />
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIndex) => (
                  <tr key={row.id} className="group">
                    {/* Row controls */}
                    <td className="bg-gray-50 border-r border-b border-gray-200 p-2 text-center align-middle text-gray-400 text-xs font-mono">
                      <div className="flex flex-col items-center gap-2">
                        <span>{rowIndex + 1}</span>
                        <button 
                          onClick={() => removeRow(row.id)}
                          className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>

                    {/* Cells */}
                    {row.cells.map((cell, colIndex) => (
                      <td 
                        key={cell.id} 
                        className={`border-r border-b border-gray-200 p-0 relative align-top transition-colors ${
                           cell.status === CellStatus.LOADING ? 'bg-blue-50/30' : 
                           cell.status === CellStatus.ERROR ? 'bg-red-50/30' : 'bg-white'
                        }`}
                      >
                        <div className="relative h-full flex flex-col min-h-[150px]">
                          {/* Cell Toolbar (Absolute) */}
                          <div className="absolute top-2 right-2 flex items-center gap-2 z-10">
                            <StatusIndicator status={cell.status} error={cell.errorMessage} />
                            
                            {!headers[colIndex].isInput && (
                               <button
                                 onClick={() => regenerateCell(row.id, colIndex)}
                                 className="p-1 text-gray-400 hover:text-indigo-600 bg-white/80 hover:bg-white rounded shadow-sm opacity-0 group-hover:opacity-100 transition-all border border-transparent hover:border-gray-200"
                                 title="Regenerate"
                               >
                                 <RefreshCw className="w-3 h-3" />
                               </button>
                            )}
                          </div>

                          {/* Editor Area */}
                          <textarea
                            value={cell.value}
                            onChange={(e) => handleCellChange(row.id, colIndex, e.target.value)}
                            onBlur={(e) => handleCellBlur(row.id, colIndex, e.target.value)}
                            onKeyDown={(e) => {
                                // Allow Ctrl+Enter to trigger blur (which triggers next step)
                                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                                    e.currentTarget.blur(); 
                                }
                            }}
                            placeholder={headers[colIndex].isInput ? "Type input..." : "Waiting for input..."}
                            className={`w-full flex-1 p-4 bg-transparent resize-none outline-none text-sm leading-relaxed text-gray-700 font-sans ${
                                headers[colIndex].isInput ? 'placeholder:text-gray-300' : 'placeholder:text-gray-200'
                            }`}
                          />
                        </div>
                      </td>
                    ))}
                    <td className="border-b border-gray-200 bg-gray-50/50"></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          <button
            onClick={addRow}
            className="mt-4 flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 hover:border-gray-400 transition-all shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Add Row
          </button>
        </div>
      </main>

      <SettingsModal 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)} 
        settings={settings}
        onSave={setSettings}
      />
    </div>
  );
};

export default App;