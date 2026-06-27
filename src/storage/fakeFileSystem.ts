/**
 * In-memory stand-in for the File System Access API, implementing only the
 * subset that `FileSystemNoteStore` touches. Construct the store in tests
 * with `new FileSystemNoteStore(asDirectoryHandle(dir))`.
 *
 * Models a real directory tree: subdirectories are navigable via
 * `getDirectoryHandle`, `values()` yields a directory's immediate children
 * (files and subdirs), and `removeEntry` can drop an (empty, or `recursive`)
 * subdirectory — enough to exercise recursive listing and nested folder ops.
 */

interface FakeFile {
    content: string;
    lastModified: number;
}

/** One monotonic clock shared across the whole fake tree, so mtimes never collide between dirs. */
class FakeClock {
    private value = 1000;
    tick = (): number => ++this.value;
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
            // Byte length stand-in (char count); attachments list() reads this for the size column.
            get size() {
                return file.content.length;
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
            async write(contents: string | Blob) {
                // Attachments are written as Blobs; read their text so the fake can store them like
                // any other file (tests only exercise text-bearing payloads).
                buffer += typeof contents === 'string' ? contents : await contents.text();
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

    private readonly clock: FakeClock;
    private readonly fileEntries = new Map<string, FakeFile>();
    private readonly dirEntries = new Map<string, FakeDirectoryHandle>();

    /**
     * @param name folder name.
     * @param caseInsensitive model a case-insensitive filesystem (macOS/Windows default), where
     *   `note.md` and `Note.md` resolve to the same entry — used to exercise case-only renames.
     *   Inherited by every subdirectory so the trick is testable at any depth.
     * @param clock shared monotonic clock (subdirectories reuse the root's; omit for a fresh tree).
     */
    constructor(
        readonly name = 'notes',
        private readonly caseInsensitive = false,
        clock?: FakeClock,
    ) {
        this.clock = clock ?? new FakeClock();
    }

    /**
     * Seed a file. A name with `/` seeds it inside the (auto-created) nested folders, e.g.
     * `seedFile('Work/Sub/Note.md', ...)`. `lastModified` defaults to a monotonic tick when omitted.
     */
    seedFile(name: string, content: string, lastModified?: number) {
        const slash = name.indexOf('/');
        if (slash !== -1) {
            this.ensureSubdir(name.slice(0, slash)).seedFile(
                name.slice(slash + 1),
                content,
                lastModified,
            );
            return;
        }
        this.fileEntries.set(name, {content, lastModified: lastModified ?? this.clock.tick()});
    }

    /** Seed an (initially empty) subdirectory. Idempotent — returns the existing one if present. */
    seedSubdir(name: string) {
        this.ensureSubdir(name);
    }

    /** All file paths in this subtree (POSIX, relative to this dir), sorted — for test assertions. */
    paths(prefix = ''): string[] {
        const here = [...this.fileEntries.keys()].map((n) => prefix + n);
        const nested = [...this.dirEntries].flatMap(([name, dir]) =>
            dir.paths(`${prefix}${name}/`),
        );
        return [...here, ...nested].sort();
    }

    async *values(): AsyncGenerator<FakeFileHandle | FakeDirectoryHandle> {
        for (const [name, file] of this.fileEntries) {
            yield new FakeFileHandle(name, file, this.clock.tick);
        }
        for (const subdir of this.dirEntries.values()) {
            yield subdir;
        }
    }

    async getFileHandle(name: string, options?: {create?: boolean}): Promise<FakeFileHandle> {
        const resolved = this.resolveName(name, this.fileEntries);
        let file = this.fileEntries.get(resolved);
        if (!file) {
            if (!options?.create) {
                throw new DOMException(`${name} not found`, 'NotFoundError');
            }
            file = {content: '', lastModified: this.clock.tick()};
            this.fileEntries.set(name, file);
            return new FakeFileHandle(name, file, this.clock.tick);
        }
        return new FakeFileHandle(resolved, file, this.clock.tick);
    }

    async getDirectoryHandle(
        name: string,
        options?: {create?: boolean},
    ): Promise<FakeDirectoryHandle> {
        const resolved = this.resolveName(name, this.dirEntries);
        const existing = this.dirEntries.get(resolved);
        if (existing) return existing;
        if (!options?.create) {
            throw new DOMException(`${name} not found`, 'NotFoundError');
        }
        return this.ensureSubdir(name);
    }

    async removeEntry(name: string, options?: {recursive?: boolean}): Promise<void> {
        if (this.fileEntries.delete(this.resolveName(name, this.fileEntries))) return;
        const dirKey = this.resolveName(name, this.dirEntries);
        const dir = this.dirEntries.get(dirKey);
        if (dir) {
            if (!options?.recursive && !dir.isEmpty()) {
                throw new DOMException(`${name} is not empty`, 'InvalidModificationError');
            }
            this.dirEntries.delete(dirKey);
            return;
        }
        throw new DOMException(`${name} not found`, 'NotFoundError');
    }

    private isEmpty(): boolean {
        return this.fileEntries.size === 0 && this.dirEntries.size === 0;
    }

    private ensureSubdir(name: string): FakeDirectoryHandle {
        const resolved = this.resolveName(name, this.dirEntries);
        let dir = this.dirEntries.get(resolved);
        if (!dir) {
            dir = new FakeDirectoryHandle(name, this.caseInsensitive, this.clock);
            this.dirEntries.set(name, dir);
        }
        return dir;
    }

    /** Map a requested name to the stored entry's name (case-folded match when case-insensitive). */
    private resolveName(name: string, entries: Map<string, unknown>): string {
        if (!this.caseInsensitive || entries.has(name)) return name;
        const lower = name.toLowerCase();
        for (const existing of entries.keys()) {
            if (existing.toLowerCase() === lower) return existing;
        }
        return name;
    }
}

export function asDirectoryHandle(fake: FakeDirectoryHandle): FileSystemDirectoryHandle {
    return fake as unknown as FileSystemDirectoryHandle;
}
