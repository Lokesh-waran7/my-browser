// Bookmarks Manager Module - Tree/folder organization, search, HTML Netscape format import/export
const electron = require('electron');
const app = electron && electron.app;
const fs = require('fs');
const path = require('path');
const os = require('os');

class BookmarksManager {
  constructor(customUserDataPath = null) {
    this.userDataPath = customUserDataPath || (app && typeof app.getPath === 'function' ? app.getPath('userData') : path.join(os.homedir(), '.coder-browser'));
    this.bookmarksFile = path.join(this.userDataPath, 'bookmarks.json');
    this.data = {
      folders: [
        { id: 'bar', name: 'Bookmarks Bar' },
        { id: 'other', name: 'Other Bookmarks' },
        { id: 'dev', name: 'Developer Resources' },
      ],
      items: [
        {
          id: 'bm-1',
          title: 'DuckDuckGo',
          url: 'https://duckduckgo.com',
          folderId: 'bar',
          createdAt: Date.now(),
        },
        {
          id: 'bm-2',
          title: 'GitHub',
          url: 'https://github.com',
          folderId: 'dev',
          createdAt: Date.now(),
        },
        {
          id: 'bm-3',
          title: 'MDN Web Docs',
          url: 'https://developer.mozilla.org',
          folderId: 'dev',
          createdAt: Date.now(),
        },
      ],
    };
    this.loadBookmarks();
  }

  loadBookmarks() {
    try {
      if (fs.existsSync(this.bookmarksFile)) {
        const raw = fs.readFileSync(this.bookmarksFile, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.items) && Array.isArray(parsed.folders)) {
          this.data = parsed;
        }
      }
    } catch (e) {
      console.warn('[BookmarksManager] Failed to load bookmarks:', e.message);
    }
  }

  saveBookmarks() {
    try {
      fs.writeFileSync(this.bookmarksFile, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (e) {
      console.error('[BookmarksManager] Failed to save bookmarks:', e.message);
    }
  }

  getFolders() {
    return this.data.folders.map((f) => f.name);
  }

  getBookmarks(folderId = null, searchQuery = '') {
    const q = (searchQuery || '').trim().toLowerCase();
    let list = this.data.items;

    if (folderId) {
      list = list.filter((b) => b.folderId === folderId);
    }

    if (q) {
      list = list.filter((b) => {
        return (
          (b.title && b.title.toLowerCase().includes(q)) ||
          (b.url && b.url.toLowerCase().includes(q))
        );
      });
    }

    return {
      folders: [...this.data.folders],
      items: list,
    };
  }

  isBookmarked(url) {
    if (!url) return false;
    const clean = url.trim().toLowerCase();
    return this.data.items.some((b) => b.url.trim().toLowerCase() === clean);
  }

  getBookmarkByUrl(url) {
    if (!url) return null;
    const clean = url.trim().toLowerCase();
    return this.data.items.find((b) => b.url.trim().toLowerCase() === clean) || null;
  }

  addBookmark({ title, url, folderId = 'bar' }) {
    if (!url) throw new Error('Bookmark URL is required.');
    const cleanUrl = url.trim();
    const cleanTitle = (title || '').trim() || cleanUrl;

    // Check if already bookmarked
    const existing = this.getBookmarkByUrl(cleanUrl);
    if (existing) {
      existing.title = cleanTitle;
      existing.folderId = folderId || existing.folderId || 'bar';
      this.saveBookmarks();
      return existing;
    }

    const item = {
      id: `bm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: cleanTitle,
      url: cleanUrl,
      folderId: folderId || 'bar',
      createdAt: Date.now(),
    };

    this.data.items.unshift(item);
    this.saveBookmarks();
    return item;
  }

  removeBookmark(idOrUrl) {
    if (!idOrUrl) return false;
    // Check if matching ID
    const initialLen = this.data.items.length;
    this.data.items = this.data.items.filter((b) => b.id !== idOrUrl && b.url.toLowerCase() !== idOrUrl.toLowerCase());
    if (this.data.items.length !== initialLen) {
      this.saveBookmarks();
      return true;
    }
    return false;
  }

  removeBookmarkById(id) {
    const initialLen = this.data.items.length;
    this.data.items = this.data.items.filter((b) => b.id !== id);
    if (this.data.items.length !== initialLen) {
      this.saveBookmarks();
      return true;
    }
    return false;
  }

  removeBookmarkByUrl(url) {
    if (!url) return false;
    const clean = url.trim().toLowerCase();
    const initialLen = this.data.items.length;
    this.data.items = this.data.items.filter((b) => b.url.trim().toLowerCase() !== clean);
    if (this.data.items.length !== initialLen) {
      this.saveBookmarks();
      return true;
    }
    return false;
  }

  updateBookmark(id, updates) {
    const item = this.data.items.find((b) => b.id === id);
    if (!item) return null;

    if (updates.title !== undefined) item.title = (updates.title || '').trim() || item.url;
    if (updates.url !== undefined) item.url = updates.url.trim();
    if (updates.folderId !== undefined) item.folderId = updates.folderId;

    this.saveBookmarks();
    return item;
  }

  addFolder(name) {
    const cleanName = (name || '').trim();
    if (!cleanName) throw new Error('Folder name is required.');

    const folder = {
      id: `folder-${Date.now()}`,
      name: cleanName,
    };
    this.data.folders.push(folder);
    this.saveBookmarks();
    return folder;
  }

  deleteFolder(folderId) {
    if (folderId === 'bar' || folderId === 'other') {
      throw new Error('Default folders cannot be deleted.');
    }
    // Move items in this folder to 'other'
    this.data.items.forEach((item) => {
      if (item.folderId === folderId) {
        item.folderId = 'other';
      }
    });
    this.data.folders = this.data.folders.filter((f) => f.id !== folderId);
    this.saveBookmarks();
    return true;
  }

  getSuggestions(query, limit = 5) {
    const q = (query || '').trim().toLowerCase();
    if (!q) return [];

    const suggestions = [];
    for (const b of this.data.items) {
      if (
        (b.title && b.title.toLowerCase().includes(q)) ||
        (b.url && b.url.toLowerCase().includes(q))
      ) {
        suggestions.push({
          type: 'bookmark',
          title: b.title,
          url: b.url,
          folder: this.data.folders.find((f) => f.id === b.folderId)?.name || 'Bookmarks',
        });
        if (suggestions.length >= limit) break;
      }
    }
    return suggestions;
  }

  /**
   * Exports bookmarks in standard Netscape Bookmark HTML format.
   */
  exportToHtml() {
    let html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file.
     It will be read and overwritten.
     DO NOT EDIT! -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>\n`;

    for (const folder of this.data.folders) {
      const itemsInFolder = this.data.items.filter((b) => b.folderId === folder.id);
      html += `    <DT><H3 ADD_DATE="${Math.floor(Date.now() / 1000)}">${folder.name}</H3>\n`;
      html += `    <DL><p>\n`;
      for (const item of itemsInFolder) {
        const title = item.title.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        html += `        <DT><A HREF="${item.url}" ADD_DATE="${Math.floor(item.createdAt / 1000)}">${title}</A>\n`;
      }
      html += `    </DL><p>\n`;
    }

    html += `</DL><p>\n`;
    return html;
  }

  /**
   * Imports bookmarks from Netscape HTML string.
   */
  importFromHtml(htmlContent) {
    if (!htmlContent || typeof htmlContent !== 'string') return 0;

    let importedCount = 0;
    let currentFolderId = 'bar';

    // Parse simple Netscape format using regex
    const lines = htmlContent.split(/\r?\n/);
    for (const line of lines) {
      // Check for folder header: <H3 ...>FolderName</H3>
      const folderMatch = line.match(/<H3[^>]*>([^<]+)<\/H3>/i);
      if (folderMatch) {
        const folderName = folderMatch[1].trim();
        let folder = this.data.folders.find((f) => f.name.toLowerCase() === folderName.toLowerCase());
        if (!folder) {
          folder = {
            id: `folder-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name: folderName,
          };
          this.data.folders.push(folder);
        }
        currentFolderId = folder.id;
        continue;
      }

      // Check for link: <A HREF="url" ...>Title</A>
      const linkMatch = line.match(/<A\s+HREF="([^"]+)"[^>]*>([^<]*)<\/A>/i);
      if (linkMatch) {
        const url = linkMatch[1].trim();
        const title = linkMatch[2].trim() || url;
        if (url.startsWith('http://') || url.startsWith('https://')) {
          this.addBookmark({
            title,
            url,
            folderId: currentFolderId,
          });
          importedCount++;
        }
      }
    }

    this.saveBookmarks();
    return { success: true, imported: importedCount, count: importedCount };
  }
}

module.exports = BookmarksManager;
