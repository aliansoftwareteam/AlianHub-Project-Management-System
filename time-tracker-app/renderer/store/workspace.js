import { createSlice } from '@reduxjs/toolkit';

// Mirrors the list the main process keeps in electron-store (main/helpers/workspaceState.js).
const workspaceSlice = createSlice({
  name: 'workspace',
  initialState: {
    loaded: false,
    workspaces: [],
    current: null,
  },
  reducers: {
    setWorkspaces: (state, action) => {
      state.loaded = true;
      state.workspaces = action.payload.workspaces || [];
      state.current = action.payload.current || null;
    },
  },
});

export const selectCurrentWorkspace = (state) => state.workspace.workspaces.find((w) => w.url === state.workspace.current) || null;

export const { setWorkspaces } = workspaceSlice.actions;
export default workspaceSlice.reducer;
