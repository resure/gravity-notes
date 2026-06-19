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
        };
    }

    async createWritable() {
        const file = this.file;
        const tick = this.tick;
        let buffer = '';
        return {
            async write(contents: string) {
                buffer += contents;
            },
            async close() {
                file.content = buffer;
                file.lastModified = tick();
            },
        };
    }
}

export class FakeDirectoryHandle {
    readonly kind = 'directory';

    private clock = 1000;
    private readonly fileEntries = new Map<string, FakeFile>();
    private readonly dirEntries = new Map<string, FakeDirectoryHandle>();

    constructor(readonly name = 'notes') {}

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
        let file = this.fileEntries.get(name);
        if (!file) {
            if (!options?.create) {
                throw new DOMException(`${name} not found`, 'NotFoundError');
            }
            file = {content: '', lastModified: ++this.clock};
            this.fileEntries.set(name, file);
        }
        return new FakeFileHandle(name, file, () => ++this.clock);
    }

    async removeEntry(name: string): Promise<void> {
        if (!this.fileEntries.delete(name)) {
            throw new DOMException(`${name} not found`, 'NotFoundError');
        }
    }
}

export function asDirectoryHandle(fake: FakeDirectoryHandle): FileSystemDirectoryHandle {
    return fake as unknown as FileSystemDirectoryHandle;
}
