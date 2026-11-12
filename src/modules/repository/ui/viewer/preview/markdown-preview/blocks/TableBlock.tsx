import { tableCells } from '../../../../../model/preview/preview';
import type { MarkdownBlock } from '../../../../../model/repository.types';
import { Inlines } from '../Inlines';

const ALIGN_CLASS = { none: '', left: 'text-left', center: 'text-center', right: 'text-right' };

/** A table, scrolled sideways when wider than the text's column; each cell aligned as written. */
export function TableBlock({ block }: { block: Extract<MarkdownBlock, { kind: 'table' }> }) {
    const table = tableCells(block.head, block.rows, block.align);
    return (
        <div className="overflow-x-auto">
            <table className="border-collapse text-[0.95em]">
                <thead>
                    <tr>
                        {table.head.map((cell) => (
                            <th
                                key={cell.key}
                                className={`border border-ui-border bg-ui-surface px-3 py-1.5 font-semibold ${ALIGN_CLASS[cell.align]}`}
                            >
                                <Inlines content={cell.content} />
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {table.rows.map((row) => (
                        <tr key={row.key}>
                            {row.cells.map((cell) => (
                                <td
                                    key={cell.key}
                                    className={`border border-ui-border px-3 py-1.5 ${ALIGN_CLASS[cell.align]}`}
                                >
                                    <Inlines content={cell.content} />
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
