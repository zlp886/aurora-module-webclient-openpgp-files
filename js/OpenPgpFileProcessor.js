'use strict';

let
	_ = require('underscore'),
	$ = require('jquery'),

	ModulesManager = require('%PathToCoreWebclientModule%/js/ModulesManager.js'),
	Ajax = require('%PathToCoreWebclientModule%/js/Ajax.js'),
	Screens = require('%PathToCoreWebclientModule%/js/Screens.js'),
	TextUtils = require('%PathToCoreWebclientModule%/js/utils/Text.js'),
	Utils = require('%PathToCoreWebclientModule%/js/utils/Common.js'),
	ErrorsUtils = require('modules/%ModuleName%/js/utils/Errors.js'),

	JscryptoKey = require('modules/CoreParanoidEncryptionWebclientPlugin/js/JscryptoKey.js'),
	HexUtils = require('modules/CoreParanoidEncryptionWebclientPlugin/js/utils/Hex.js'),
	OpenPgpEncryptor = ModulesManager.run('OpenPgpWebclient', 'getOpenPgpEncryptor')
;

/**
 * @constructor
 */
function OpenPgpFileProcessor()
{
}

OpenPgpFileProcessor.prototype.processFileEncryption = async function (oFile, oFilesView, sRecipientEmail, bIsPasswordMode, bSign, sPassphrase)
{
	const sPath = oFilesView.currentPath();
	const sStorageType = oFilesView.storageType();
	let oResultData = { result: false };
	const sParanoidEncryptedKey = oFile?.oExtendedProps?.ParanoidKey || '';
	if (sParanoidEncryptedKey)
	{
		//decrypt key
		let oPGPDecryptionResult = await OpenPgpEncryptor.decryptData(
			sParanoidEncryptedKey,
			sPassphrase
		);
		if (oPGPDecryptionResult.result)
		{
			const sKey = oPGPDecryptionResult.result;
			//encrypt Paranoid key
			let aPublicKeys = sRecipientEmail && !bIsPasswordMode ?
				OpenPgpEncryptor.findKeysByEmails([sRecipientEmail], /*bIsPublic*/true)
				: [];
			const { data: sEncryptedKey, password: sPassword } = await OpenPgpEncryptor.encryptAndSignWithCurrentPrivateKey(
				sKey,
				aPublicKeys,
				sPassphrase,
				bIsPasswordMode
			);
			if (sEncryptedKey)
			{
				//Update ParanoidKeyPublic
				const bUpdateExtendedProps = await this.updateFileExtendedProps(
					oFile,
					{ ParanoidKeyPublic: sEncryptedKey }
				);
				if (bUpdateExtendedProps)
				{
					//creating a public link
					let oPublicLinkResult = await this.createPublicLink(
						oFile.storageType(),
						oFile.path(),
						oFile.fileName(),
						oFile.size(),
						false,
						sRecipientEmail,
						bIsPasswordMode ? Enums.EncryptionBasedOn.Password : Enums.EncryptionBasedOn.Key
					);
					if (oPublicLinkResult.result)
					{
						oFilesView.refresh();
						oResultData.result = true;
						oResultData.password = sPassword;
						oResultData.link = oPublicLinkResult.link;
					}
				}
				else
				{
					Screens.showError(TextUtils.i18n('%MODULENAME%/ERROR_UPDATING_KEY'));
				}
			}
		}
		else
		{
			ErrorsUtils.showPgpErrorByCode(oPGPDecryptionResult, Enums.PgpAction.DecryptVerify);
		}
	}
	else
	{
		Screens.showError('%MODULENAME%/ERROR_READING_KEY');
	}

	return oResultData;
};

OpenPgpFileProcessor.prototype.decryptFile = async function (oBlob, sRecipientEmail, sPassword, bPasswordBasedEncryption, sParanoidKeyPublic, sInitializationVector)
{
	let oResult = {
		result: false
	};

	try
	{
		//key decryption
		let oPGPDecryptionResult = await OpenPgpEncryptor.decryptData(
			sParanoidKeyPublic,
			sPassword,
			bPasswordBasedEncryption
		);
		if (!oPGPDecryptionResult.result)
		{
			ErrorsUtils.showPgpErrorByCode(oPGPDecryptionResult, Enums.PgpAction.DecryptVerify);
		}
		else
		{
			//signature verification
			if (oPGPDecryptionResult.validKeyNames
				&& oPGPDecryptionResult.validKeyNames.length
			)
			{
				const oCurrentUserPrivateKey = await OpenPgpEncryptor.getCurrentUserPrivateKey();
				if (!oCurrentUserPrivateKey
					|| !oPGPDecryptionResult.validKeyNames.includes(oCurrentUserPrivateKey.getUser())
				)
				{//Paranoid-key was signed with a foreign key
					const sReport = TextUtils.i18n('%MODULENAME%/REPORT_SUCCESSFULL_SIGNATURE_VERIFICATION')
						+ oPGPDecryptionResult.validKeyNames.join(', ').replace(/</g, "&lt;").replace(/>/g, "&gt;");
					Screens.showReport(sReport)
				}
			}
			else
			{
				Screens.showError(TextUtils.i18n('%MODULENAME%/ERROR_SIGNATURE_NOT_VERIFIED'));
			}
			//file decryption
			const sKey = oPGPDecryptionResult.result;
			let oDecryptedFileData = await this.decryptAsSingleChunk(oBlob, sKey, sInitializationVector);
			//save decrypted file
			if (oDecryptedFileData)
			{
				let oResBlob = new Blob(
					[ oDecryptedFileData ],
					{
						type: "octet/stream",
						lastModified: new Date()
					}
				);
				oResult.result = true;
				oResult.blob = oResBlob;
			}
		}

		return oResult;
	}
	catch (oError)
	{ console.log(oError)
		return oResult;
	}
};

OpenPgpFileProcessor.prototype.createPublicLink = async function (sType, sPath, sFileName, iSize, bEncryptLink = false, sRecipientEmail = '', sPgpEncryptionMode = '')
{
	let sLink = '';
	let oResult = {result: false};
	const sPassword = bEncryptLink || sPgpEncryptionMode === Enums.EncryptionBasedOn.Password
		? OpenPgpEncryptor.generatePassword()
		: '';
	const oPromiseCreatePublicLink = new Promise( (resolve, reject) => {
		const fResponseCallback = (oResponse, oRequest) => {
			if (oResponse.Result && oResponse.Result.link)
			{
				resolve(oResponse.Result.link);
			}
			reject(new Error(TextUtils.i18n('%MODULENAME%/ERROR_PUBLIC_LINK_CREATION')));
		};
		let oParams = {
			'Type': sType,
			'Path': sPath,
			'Name': sFileName,
			'Size': iSize,
			'IsFolder': false,
			'Password': sPassword,
			'RecipientEmail': sRecipientEmail,
			'PgpEncryptionMode': sPgpEncryptionMode
		};

		Ajax.send(
			'OpenPgpFilesWebclient',
			'CreatePublicLink',
			oParams,
			fResponseCallback,
			this
		);
	});
	try
	{
		sLink = await oPromiseCreatePublicLink;
		oResult.result = true;
		oResult.link = sLink;
		oResult.password = sPassword;
	}
	catch (oError)
	{
		if (oError && oError.message)
		{
			Screens.showError(oError.message);
		}
	}

	return oResult;
};

OpenPgpFileProcessor.prototype.getFileContentByUrl = async function (sDownloadUrl, onDownloadProgressCallback)
{
	let response = await fetch(sDownloadUrl);
	if (response.ok)
	{
		const reader = response.body.getReader();
		let iReceivedLength = 0;
		let aChunks = [];
		while (true)
		{
			const {done, value} = await reader.read();
			if (done)
			{
				break;
			}
			iReceivedLength += value.length;
			aChunks.push(value);
			if (_.isFunction(onDownloadProgressCallback))
			{
				onDownloadProgressCallback(iReceivedLength);
			}
		}

		return new Blob(aChunks);
	}
	else
	{
		return false;
	}
};

OpenPgpFileProcessor.prototype.saveBlob = async function (oBlob, sFileName)
{
	if (window.navigator && window.navigator.msSaveOrOpenBlob) {
		window.navigator.msSaveOrOpenBlob(oBlob, sFileName);
		return;
	}
	let blobUrl = window.URL.createObjectURL(oBlob);
	let link = document.createElement("a");
	link.href = blobUrl;
	link.download = sFileName;
	document.body.appendChild(link);
	link.click();
	window.URL.revokeObjectURL(blobUrl);
};

OpenPgpFileProcessor.prototype.processFileDecryption = async function (sFileName, sDownloadUrl, sRecipientEmail, sPassword, sEncryptionMode, sParanoidKeyPublic, sInitializationVector)
{
	let oBlob = await this.getFileContentByUrl(sDownloadUrl);
	if (oBlob instanceof Blob)
	{
		let oDecryptionResult = await this.decryptFile(
			oBlob,
			sRecipientEmail,
			sPassword,
			sEncryptionMode === Enums.EncryptionBasedOn.Password,
			sParanoidKeyPublic,
			sInitializationVector
		);
		if (oDecryptionResult.result)
		{
			this.saveBlob(
				oDecryptionResult.blob,
				sFileName
			);
		}
		else
		{
			Screens.showError(TextUtils.i18n('%MODULENAME%/ERROR_ON_DOWNLOAD'));
		}
	}
	else
	{
		Screens.showError(TextUtils.i18n('%MODULENAME%/ERROR_ON_DOWNLOAD'));
	}
};

OpenPgpFileProcessor.prototype.getFileNameForDownload = function (sFileName, sRecipientEmail)
{
	const sFileNameWithoutExtension = Utils.getFileNameWithoutExtension(sFileName);
	const sDelimiter = '_' + sRecipientEmail;
	const aNameParts = sFileNameWithoutExtension.split(sDelimiter);
	let sNewName = '';
	if (aNameParts.length <= 2)
	{
		sNewName = aNameParts.join('');
	}
	else
	{
		//If the files name contains more than one entry of a recipient email, only the last entry is removed
		for (let i = 0; i < aNameParts.length; i++)
		{
			sNewName += aNameParts[i];
			sNewName += i < (aNameParts.length - 2) ? sDelimiter : '';
		}
	}

	return sNewName;
};

OpenPgpFileProcessor.prototype.updateFileExtendedProps = async function (oFile, oExtendedProps) {
	//Update file extended props
	let oPromiseUpdateExtendedProps = new Promise( (resolve, reject) => {
		Ajax.send(
			'Files',
			'UpdateExtendedProps',
			{
				Type: oFile.storageType(),
				Path: oFile.path(),
				Name: oFile.fileName(),
				ExtendedProps: oExtendedProps
			},
			oResponse => {
				if (oResponse.Result === true)
				{
					resolve(true);
				}
				resolve(false);
			},
			this
		);
	});

	return await oPromiseUpdateExtendedProps;
};

OpenPgpFileProcessor.prototype.decryptAsSingleChunk = async function (oBlob, sKey, sInitializationVector) {
	let oKey = await JscryptoKey.getKeyFromString(sKey);
	let aEncryptedData = await new Response(oBlob).arrayBuffer();
	let oDecryptedArrayBuffer = await crypto.subtle.decrypt(
		{
			name: 'AES-CBC',
			iv: new Uint8Array(HexUtils.HexString2Array(sInitializationVector))
		},
		oKey,
		aEncryptedData
	);

	return new Uint8Array(oDecryptedArrayBuffer);
};

module.exports = new OpenPgpFileProcessor();
