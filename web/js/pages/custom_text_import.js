// 导入结果展示相关函数
CustomText.showImportResult = function(result, originalFilePath) {
    // 解析导入结果
    const success = result.success || false;
    const mappingInfo = result.mapping_info || result.details || [];
    const importedCount = (result.imported_files || []).length;
    const unrecognizedFiles = result.unrecognized_files || [];
    const unrecognizedCount = unrecognizedFiles.length;

    // 分类处理映射信息
    const successItems = [];
    const warningItems = [];
    const errorItems = [];

    mappingInfo.forEach(info => {
        const infoStr = String(info);
        if (infoStr.startsWith('✓')) {
            successItems.push(infoStr.substring(1).trim());
        } else if (infoStr.startsWith('⚠')) {
            warningItems.push(infoStr.substring(1).trim());
        } else if (infoStr.startsWith('✗')) {
            errorItems.push(infoStr.substring(1).trim());
        } else {
            // 默认归类
            if (infoStr.includes('无法识别') || infoStr.includes('已导入')) {
                warningItems.push(infoStr);
            } else if (infoStr.includes('失败')) {
                errorItems.push(infoStr);
            } else {
                successItems.push(infoStr);
            }
        }
    });

    // 创建模态框
    const overlay = document.createElement('div');
    overlay.className = 'import-result-overlay';
    overlay.onclick = (e) => {
        if (e.target === overlay) {
            overlay.remove();
        }
    };

    const modal = document.createElement('div');
    modal.className = 'import-result-modal';
    modal.onclick = (e) => e.stopPropagation();

    // 确定图标类型
    let iconClass = 'success';
    let iconSymbol = '✓';
    let titleText = '导入成功';

    if (!success) {
        iconClass = 'error';
        iconSymbol = '✗';
        titleText = '导入失败';
    } else if (unrecognizedCount > 0) {
        iconClass = 'warning';
        iconSymbol = '⚠';
        titleText = '导入完成（含无法识别的文件）';
    }

    // 构建HTML
    modal.innerHTML = `
        <div class="import-result-header">
            <div class="import-result-title">
                <div class="import-result-icon ${iconClass}">${iconSymbol}</div>
                <span>${titleText}</span>
            </div>
            <button class="import-result-close" onclick="this.closest('.import-result-overlay').remove()">×</button>
        </div>
        <div class="import-result-body">
            ${CustomText.renderImportSummary(result, importedCount, unrecognizedCount)}
            ${CustomText.renderImportSection('成功导入', successItems, 'success')}
            ${CustomText.renderImportSection('无法识别（已导入）', warningItems, 'warning')}
            ${CustomText.renderImportSection('导入失败', errorItems, 'error')}
            ${unrecognizedCount > 0 ? CustomText.renderUnrecognizedFilesSection(unrecognizedFiles) : ''}
        </div>
        <div class="import-result-footer">
            <button class="import-result-btn import-result-btn-primary" onclick="this.closest('.import-result-overlay').remove()">
                确定
            </button>
        </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
};

CustomText.renderUnrecognizedFilesSection = function(unrecognizedFiles) {
    const fileListHtml = unrecognizedFiles.map((fileName) => `
        <div class="manual-import-file-item">
            <label class="manual-import-file-label">
                <input type="checkbox" class="unrecognized-file-checkbox" value="${CustomText.escapeHtml(fileName)}">
                <span class="manual-import-file-name">${CustomText.escapeHtml(fileName)}</span>
            </label>
        </div>
    `).join('');

    return `
        <div class="import-result-section" style="margin-top: 24px;">
            <div class="manual-import-warning">
                <div class="manual-import-warning-icon">!</div>
                <div class="manual-import-warning-text">
                    <strong>是否保留这些文件？</strong><br>
                    以下文件无法自动识别，但已以<strong>原文件名</strong>导入到 <code>lang/aimerWT/</code> 目录。<br>
                    如果您确定这些文件有效，请保留；否则可以选择删除。
                </div>
            </div>
            <div class="import-result-section-title">
                选择要删除的文件
                <span class="import-result-section-badge warning">${unrecognizedFiles.length}</span>
            </div>
            <div class="manual-import-files-list">
                ${fileListHtml}
            </div>
            <div style="margin-top: 16px; display: flex; gap: 12px; justify-content: flex-end;">
                <button class="import-result-btn import-result-btn-secondary" onclick="CustomText.deleteUnrecognizedFiles(this)">
                    <i class="ri-delete-bin-line"></i> 删除选中的文件
                </button>
            </div>
        </div>
    `;
};

CustomText.deleteUnrecognizedFiles = async function(buttonElement) {
    const modal = buttonElement.closest('.import-result-modal');
    const checkboxes = modal.querySelectorAll('.unrecognized-file-checkbox:checked');
    const selectedFiles = Array.from(checkboxes).map(cb => cb.value);

    if (selectedFiles.length === 0) {
        app.showAlert('提示', '未选择任何文件', 'warn');
        return;
    }

    // 确认删除
    if (!confirm(`确定要删除 ${selectedFiles.length} 个文件吗？\n\n${selectedFiles.join('\n')}`)) {
        return;
    }

    try {
        const res = await pywebview.api.delete_custom_text_files({
            file_names: selectedFiles
        });

        if (res && res.success) {
            app.showAlert('成功', res.msg || '删除成功', 'success');
            // 关闭对话框并刷新
            buttonElement.closest('.import-result-overlay').remove();
            CustomText.loadData();
        } else {
            app.showAlert('错误', res.msg || '删除失败', 'error');
        }
    } catch (e) {
        app.showAlert('错误', `删除失败: ${e.message || e}`, 'error');
    }
};
