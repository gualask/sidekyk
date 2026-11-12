import { DiagramBlock } from '../diagram/DiagramBlock';
import { CodeFrame } from './CodeBlock';
import { type DiagramBlockOf, usePreview } from './preview-context';

/** A ` ```mermaid ` block: its diagram, which opens over the preview; its source while it never drew. */
export function MermaidBlock({ block }: { block: DiagramBlockOf }) {
    const { openDiagram } = usePreview();
    return (
        <DiagramBlock
            source={block.source}
            code={
                <CodeFrame>
                    <code>{block.source}</code>
                </CodeFrame>
            }
            onOpen={() => openDiagram(block)}
        />
    );
}
