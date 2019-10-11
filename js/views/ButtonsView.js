'use strict';

let
	CFileModel = require('modules/FilesWebclient/js/models/CFileModel.js'),
	Utils = require('%PathToCoreWebclientModule%/js/utils/Common.js'),
	OpenPgpFileProcessor = require('modules/%ModuleName%/js/OpenPgpFileProcessor.js')
;

/**
 * @constructor
 */
function ButtonsView()
{
}

ButtonsView.prototype.ViewTemplate = '%ModuleName%_ButtonsView';

ButtonsView.prototype.useFilesViewData = function (oFilesView)
{
	let selectedItem = oFilesView.selector.itemSelected;
	this.storageType = oFilesView.storageType;
	this.secureShareCommand = Utils.createCommand(this,
		() => {
			OpenPgpFileProcessor.processFileEncryption(selectedItem(), oFilesView);
		},
		() => {//button is active only when one file is selected
			return selectedItem() !== null
				&& oFilesView.selector.listCheckedAndSelected().length === 1
				&& selectedItem() instanceof CFileModel
				&& (oFilesView.storageType() === Enums.FileStorageType.Personal
					|| oFilesView.storageType() === Enums.FileStorageType.Encrypted)
				&& (!selectedItem().oExtendedProps || !selectedItem().oExtendedProps.PgpEncryptionMode);
		}
	);
};

module.exports = new ButtonsView();
