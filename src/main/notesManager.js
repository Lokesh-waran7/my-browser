// Notes Manager Module - Workspace-scoped Markdown notes, auto-save, and export
const { app, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

class NotesManager {
  constructor() {
    this.userDataPath = app.getPath('userData');
    this.notesFile = path.join(this.userDataPath, 'notes.json');
    this.notesByWorkspace = {};
    this.loadNotes();
  }

  loadNotes() {
    try {
      if (fs.existsSync(this.notesFile)) {
        this.notesByWorkspace = JSON.parse(fs.readFileSync(this.notesFile, 'utf8'));
      }
    } catch (e) {
      this.notesByWorkspace = {};
    }
  }

  saveToDisk() {
    try {
      fs.writeFileSync(this.notesFile, JSON.stringify(this.notesByWorkspace, null, 2), 'utf8');
    } catch (e) {
      console.error('[NotesManager] Error saving notes to disk:', e);
    }
  }

  getWorkspaceNotes(workspaceId) {
    const wsId = workspaceId || 'ws-default';
    if (!this.notesByWorkspace[wsId]) {
      // Create initial welcome note for workspace
      const defaultNote = {
        id: `note-${Date.now()}`,
        title: 'Welcome to Dev Notes',
        content: `# Workspace Notes\n\nQuick notes, code snippets, and research for this workspace.\n\n- Click **+ New Note** to create a document.\n- Use **Add Current Page** to attach references.\n- Select text on any web page, right-click, and choose **Send selection to notes**.\n- Export as Markdown anytime!`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.notesByWorkspace[wsId] = [defaultNote];
      this.saveToDisk();
    }
    return this.notesByWorkspace[wsId];
  }

  saveNote(workspaceId, note) {
    const wsId = workspaceId || 'ws-default';
    if (!this.notesByWorkspace[wsId]) {
      this.notesByWorkspace[wsId] = [];
    }

    const id = note.id || `note-${Date.now()}`;
    const existingIdx = this.notesByWorkspace[wsId].findIndex((n) => n.id === id);

    const noteRecord = {
      id,
      title: (note.title || 'Untitled Note').trim() || 'Untitled Note',
      content: note.content || '',
      createdAt: note.createdAt || Date.now(),
      updatedAt: Date.now(),
    };

    if (existingIdx !== -1) {
      this.notesByWorkspace[wsId][existingIdx] = noteRecord;
    } else {
      this.notesByWorkspace[wsId].unshift(noteRecord);
    }

    this.saveToDisk();
    return noteRecord;
  }

  deleteNote(workspaceId, noteId) {
    const wsId = workspaceId || 'ws-default';
    if (!this.notesByWorkspace[wsId]) return false;
    this.notesByWorkspace[wsId] = this.notesByWorkspace[wsId].filter((n) => n.id !== noteId);
    this.saveToDisk();
    return true;
  }

  async exportNote(parentWindow, noteTitle, content) {
    const defaultName = `${(noteTitle || 'note').replace(/[^a-zA-Z0-9_-]/g, '_')}.md`;
    const result = await dialog.showSaveDialog(parentWindow, {
      title: 'Export Note as Markdown',
      defaultPath: defaultName,
      filters: [{ name: 'Markdown Document', extensions: ['md'] }],
    });

    if (!result.canceled && result.filePath) {
      fs.writeFileSync(result.filePath, content || '', 'utf8');
      return { success: true, filePath: result.filePath };
    }
    return { success: false, canceled: true };
  }
}

module.exports = NotesManager;
