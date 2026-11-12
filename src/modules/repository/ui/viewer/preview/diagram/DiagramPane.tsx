import { useTranslation } from '@/shared/i18n';
import { useFileContent } from '../../../../application/queries/file-reads';
import { ErrorText, Notice } from '../../pane/Pane';
import { DiagramView } from './DiagramView';

/** A `.mmd` file's preview: its diagram filling the panel, drawn again as the file changes. */
export function DiagramPane({ folderId, path }: { folderId: string; path: string }) {
    const i18n = useTranslation();
    const file = useFileContent(folderId, path);
    if (file.isPending) return <Notice>{i18n.t('view.loadingFile')}</Notice>;
    if (file.isError) {
        return (
            <Notice>
                <ErrorText error={file.error} />
            </Notice>
        );
    }
    if (file.data?.kind !== 'text') return <Notice>{i18n.t('preview.none')}</Notice>;
    return <DiagramView source={file.data.text} onClose={null} />;
}
