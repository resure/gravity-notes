/**
 * In-memory stand-in for the File System Access API, implementing only the
 * subset that `FileSystemNoteStore` touches. Construct the store in tests
 * with `new FileSystemNoteStore(asDirectoryHandle(dir))`.
 */

interface FakeFile {
    content: string;
    lastModified: number;
}

class FakeFileHandle {
    readonly kind = 'file';

    constructor(
        readonly name: string,
        private readonly file: FakeFile,
        private readonly tick: () => number,
    ) {}

    async getFile() {
        const file = this.file;
        const name = this.name;
        return {
            name,
            get lastModified() {
                return file.lastModified;
            },
            async text() {
                return file.content;
            },
            // Minimal Blob.slice stand-in: only the prefix read in list() is exercised.
            slice(start?: number, end?: number) {
                return {
                    async text() {
                        return file.content.slice(start, end);
                    },
                };
            },
        };
    }

    async createWritable() {
        const file = this.file;
        const tick = this.tick;
        let buffer = '';
        let aborted = false;
        return {
            async write(contents: string) {
                buffer += contents;
            },
            async close() {
                if (aborted) return;
                file.content = buffer;
                file.lastModified = tick();
            },
            // Mirror FileSystemWritableFileStream.abort(): discard the buffered write, leaving
            // the original file untouched (the real stream commits atomically only on close()).
            async abort() {
                aborted = true;
            },
        };
    }
}

export class FakeDirectoryHandle {
    readonly kind = 'directory';

    private clock = 1000;
    private readonly fileEntries = new Map<string, FakeFile>();
    private readonly dirEntries = new Map<string, FakeDirectoryHandle>();

    /**
     * @param name folder name.
     * @param caseInsensitive model a case-insensitive filesystem (macOS/Windows default), where
     *   `note.md` and `Note.md` resolve to the same entry — used to exercise case-only renames.
     */
    constructor(
        readonly name = 'notes',
        private readonly caseInsensitive = false,
    ) {}

    /** Seed a file. `lastModified` defaults to a monotonic tick when omitted. */
    seedFile(name: string, content: string, lastModified?: number) {
        this.fileEntries.set(name, {
            content,
            lastModified: lastModified ?? ++this.clock,
        });
    }

    /** Seed a subdirectory, to verify the store ignores non-file entries. */
    seedSubdir(name: string) {
        this.dirEntries.set(name, new FakeDirectoryHandle(name));
    }

    async *values(): AsyncGenerator<FakeFileHandle | FakeDirectoryHandle> {
        for (const [name, file] of this.fileEntries) {
            yield new FakeFileHandle(name, file, () => ++this.clock);
        }
        for (const subdir of this.dirEntries.values()) {
            yield subdir;
        }
    }

    async getFileHandle(name: string, options?: {create?: boolean}): Promise<FakeFileHandle> {
        const resolved = this.resolveName(name);
        let file = this.fileEntries.get(resolved);
        if (!file) {
            if (!options?.create) {
                throw new DOMException(`${name} not found`, 'NotFoundError');
            }
            file = {content: '', lastModified: ++this.clock};
            this.fileEntries.set(name, file);
            return new FakeFileHandle(name, file, () => ++this.clock);
        }
        return new FakeFileHandle(resolved, file, () => ++this.clock);
    }

    async removeEntry(name: string): Promise<void> {
        if (!this.fileEntries.delete(this.resolveName(name))) {
            throw new DOMException(`${name} not found`, 'NotFoundError');
        }
    }

    /** Map a requested name to the stored entry's name (case-folded match when case-insensitive). */
    private resolveName(name: string): string {
        if (!this.caseInsensitive || this.fileEntries.has(name)) return name;
        const lower = name.toLowerCase();
        for (const existing of this.fileEntries.keys()) {
            if (existing.toLowerCase() === lower) return existing;
        }
        return name;
    }
}

export function asDirectoryHandle(fake: FakeDirectoryHandle): FileSystemDirectoryHandle {
    return fake as unknown as FileSystemDirectoryHandle;
}
