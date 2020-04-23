// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/** @jsx jsx */
import { jsx } from '@emotion/core';
import { useState, useContext, useEffect, Fragment, useCallback, useMemo } from 'react';
import { RouteComponentProps } from '@reach/router';
import formatMessage from 'format-message';
import { Dialog, DialogType } from 'office-ui-fabric-react/lib/Dialog';
import { TextField } from 'office-ui-fabric-react/lib/TextField';

import settingsStorage from '../../utils/dialogSettingStorage';
import { projectContainer } from '../design/styles';
import { StoreContext } from '../../store';
import { navigateTo } from '../../utils';

import { TargetList } from './targetList';
import { PublishDialog } from './publishDialog';
import { ToolBar } from './../../components/ToolBar/index';
import { OpenConfirmModal } from './../../components/Modal/Confirm';
import { ContentHeaderStyle, HeaderText, ContentStyle, contentEditor, overflowSet, targetSelected } from './styles';
import { CreatePublishTarget } from './createPublishTarget';
import { PublishStatusList } from './publishStatusList';

interface PublishPageProps extends RouteComponentProps<{}> {
  targetName?: string;
}

const Publish: React.FC<PublishPageProps> = props => {
  const selectedTargetName = props.targetName;
  const [selectedTarget, setSelectedTarget] = useState();
  const { state, actions } = useContext(StoreContext);
  const { settings, botName, publishTypes, projectId, publishHistory } = state;

  const [addDialogHidden, setAddDialogHidden] = useState(true);
  const [editDialogHidden, setEditDialogHidden] = useState(true);

  const [showLog, setShowLog] = useState(false);
  const [publishDialogHidden, setPublishDialogHidden] = useState(true);

  // items to show in the list
  const [thisPublishHistory, setThisPublishHistory] = useState<any[]>([]);
  const [groups, setGroups] = useState();
  const [selectedVersion, setSelectedVersion] = useState();
  const [dialogProps, setDialogProps] = useState({
    title: 'Title',
    type: DialogType.normal,
    children: {},
  });
  const [editDialogProps, setEditDialogProps] = useState({
    title: 'Title',
    type: DialogType.normal,
    children: {},
  });
  const [editTarget, setEditTarget] = useState();

  const isRollbackSupported = useMemo(
    () => (target, version): boolean => {
      if (version.id && version.status === 200 && target) {
        const type = publishTypes?.filter(t => t.name === target.type)[0];
        if (type?.features?.rollback) {
          return true;
        }
      }
      return false;
    },
    [projectId, publishTypes]
  );

  const toolbarItems = [
    {
      type: 'action',
      text: formatMessage('Add new profile'),
      buttonProps: {
        iconProps: {
          iconName: 'Add',
        },
        onClick: () => setAddDialogHidden(false),
      },
      align: 'left',
      dataTestid: 'publishPage-ToolBar-Add',
      disabled: false,
    },
    {
      type: 'action',
      text: formatMessage('Publish to selected profile'),
      buttonProps: {
        iconProps: {
          iconName: 'CloudUpload',
        },
        onClick: () => setPublishDialogHidden(false),
      },
      align: 'left',
      dataTestid: 'publishPage-ToolBar-Publish',
      disabled: selectedTargetName !== 'all' ? false : true,
    },
    {
      type: 'action',
      text: formatMessage('See Log'),
      buttonProps: {
        iconProps: {
          iconName: 'ClipboardList',
        },
        onClick: () => setShowLog(true),
      },
      align: 'left',
      disabled: selectedVersion ? false : true,
      dataTestid: 'publishPage-ToolBar-Log',
    },
    {
      type: 'action',
      text: formatMessage('Rollback'),
      buttonProps: {
        iconProps: {
          iconName: 'ClipboardList',
        },
        onClick: () => rollbackToVersion(selectedVersion),
      },
      align: 'left',
      disabled: selectedTarget && selectedVersion ? !isRollbackSupported(selectedTarget, selectedVersion) : true,
      dataTestid: 'publishPage-ToolBar-Log',
    },
  ];

  const onSelectTarget = useCallback(
    targetName => {
      const url = `/bot/${projectId}/publish/${targetName}`;
      navigateTo(url);
    },
    [projectId]
  );

  const getUpdatedStatus = target => {
    if (target) {
      // TODO: this should use a backoff mechanism to not overload the server with requests
      // OR BETTER YET, use a websocket events system to receive updates... (SOON!)
      setTimeout(async () => {
        await actions.getPublishStatus(projectId, target);
      }, 10000);
    }
  };

  useEffect(() => {
    if (projectId) {
      actions.getPublishTargetTypes();
      // init selected status
      setSelectedVersion(undefined);
    }
  }, [projectId]);

  useEffect(() => {
    if (settings.publishTargets && settings.publishTargets.length > 0) {
      const _selected = settings.publishTargets.find(item => item.name === selectedTargetName);
      setSelectedTarget(_selected);
      // load publish histories
      if (selectedTargetName === 'all') {
        for (const target of settings.publishTargets) {
          actions.getPublishHistory(projectId, target);
        }
      } else if (_selected) {
        actions.getPublishHistory(projectId, _selected);
      }
    }
  }, [projectId, selectedTargetName]);

  // once history is loaded, display it
  useEffect(() => {
    if (settings.publishTargets && selectedTargetName === 'all') {
      let _histories: any[] = [];
      const _groups: any[] = [];
      let startIndex = 0;
      for (const target of settings.publishTargets) {
        if (publishHistory[target.name]) {
          _histories = _histories.concat(publishHistory[target.name]);
          _groups.push({
            key: target.name,
            name: target.name,
            startIndex: startIndex,
            count: publishHistory[target.name].length,
            level: 0,
          });
          startIndex += publishHistory[target.name].length;
        }
      }
      setGroups(_groups);
      setThisPublishHistory(_histories);
    } else if (selectedTargetName && publishHistory[selectedTargetName]) {
      setThisPublishHistory(publishHistory[selectedTargetName]);
      setGroups([
        {
          key: selectedTargetName,
          name: selectedTargetName,
          startIndex: 0,
          count: publishHistory[selectedTargetName].length,
          level: 0,
        },
      ]);
    }
  }, [publishHistory, selectedTargetName]);

  // check history to see if a 202 is found
  useEffect(() => {
    // most recent item is a 202, which means we should poll for updates...
    if (selectedTargetName !== 'all' && thisPublishHistory.length && thisPublishHistory[0].status === 202) {
      getUpdatedStatus(selectedTarget);
    } else if (selectedTarget && selectedTarget.lastPublished && thisPublishHistory.length === 0) {
      // if the history is EMPTY, but we think we've done a publish based on lastPublished timestamp,
      // we still poll for the results IF we see that a publish has happened previously
      actions.getPublishStatus(projectId, selectedTarget);
    }
  }, [thisPublishHistory, selectedTargetName]);

  const savePublishTarget = useMemo(
    () => async (name, type, configuration) => {
      const _target = (settings.publishTargets || []).concat([
        {
          name,
          type,
          configuration,
        },
      ]);
      await actions.setSettings(
        projectId,
        botName,
        {
          ...settings,
          publishTargets: _target,
        },
        undefined
      );
      onSelectTarget(name);
    },
    [settings.publishTargets, projectId, botName]
  );

  const updatePublishTarget = useMemo(
    () => async (name, type, configuration) => {
      const _targets = settings.publishTargets ? [...settings.publishTargets] : [];

      _targets[editTarget.index] = {
        name,
        type,
        configuration,
      };

      await actions.setSettings(
        projectId,
        botName,
        {
          ...settings,
          publishTargets: _targets,
        },
        undefined
      );

      onSelectTarget(name);
    },
    [settings.publishTargets, projectId, botName, editTarget]
  );

  useEffect(() => {
    setDialogProps({
      title: formatMessage('Add a publish profile'),
      type: DialogType.normal,
      children: (
        <CreatePublishTarget
          targetTypes={publishTypes.map(type => {
            return { key: type.name, text: type.name };
          })}
          targets={settings.publishTargets}
          updateSettings={savePublishTarget}
          current={null}
          closeDialog={() => setAddDialogHidden(true)}
        />
      ),
    });
  }, [publishTypes, savePublishTarget, settings.publishTargets]);

  useEffect(() => {
    setEditDialogProps({
      title: formatMessage('Edit a publish profile'),
      type: DialogType.normal,
      children: (
        <CreatePublishTarget
          targetTypes={publishTypes.map(type => {
            return { key: type.name, text: type.name };
          })}
          current={editTarget ? editTarget.item : null}
          targets={settings.publishTargets?.filter(item => editTarget && item.name != editTarget.item.name)}
          updateSettings={updatePublishTarget}
          closeDialog={() => setEditDialogHidden(true)}
        />
      ),
    });
  }, [editTarget, publishTypes, updatePublishTarget]);

  const rollbackToVersion = useMemo(
    () => async version => {
      const sensitiveSettings = settingsStorage.get(botName);
      await actions.rollbackToVersion(projectId, selectedTarget, version.id, sensitiveSettings);
    },
    [projectId, selectedTarget]
  );

  const publish = useMemo(
    () => async comment => {
      // publish to remote
      if (selectedTarget && settings.publishTargets) {
        const sensitiveSettings = settingsStorage.get(botName);
        await actions.publishToTarget(projectId, selectedTarget, { comment: comment }, sensitiveSettings);

        // update the target with a lastPublished date
        const updatedPublishTargets = settings.publishTargets.map(profile => {
          if (profile.name === selectedTarget.name) {
            return {
              ...profile,
              lastPublished: new Date(),
            };
          } else {
            return profile;
          }
        });

        await actions.setSettings(
          projectId,
          botName,
          {
            ...settings,
            publishTargets: updatedPublishTargets,
          },
          undefined
        );
      }
    },
    [projectId, selectedTarget, settings.publishTargets]
  );

  const onEdit = async (index: number, item: any) => {
    const newItem = { item: item, index: index };
    setEditTarget(newItem);
    setEditDialogHidden(false);
  };

  const onDelete = useMemo(
    () => async (index: number) => {
      const result = await OpenConfirmModal(
        formatMessage('This will delete the profile. Do you wish to continue?'),
        null,
        {
          confirmBtnText: formatMessage('Yes'),
          cancelBtnText: formatMessage('Cancel'),
        }
      );

      if (result) {
        if (settings.publishTargets && settings.publishTargets.length > index) {
          const _target = settings.publishTargets.slice(0, index).concat(settings.publishTargets.slice(index + 1));
          await actions.setSettings(
            projectId,
            botName,
            {
              ...settings,
              publishTargets: _target,
            },
            undefined
          );
          // redirect to all profiles
          setSelectedTarget(undefined);
          onSelectTarget('all');
        }
      }
    },
    [settings.publishTargets, projectId, botName]
  );

  return (
    <Fragment>
      <Dialog
        hidden={addDialogHidden}
        onDismiss={() => setAddDialogHidden(true)}
        dialogContentProps={dialogProps}
        modalProps={{ isBlocking: true }}
        minWidth={500}
      >
        {dialogProps.children}
      </Dialog>
      <Dialog
        hidden={editDialogHidden}
        onDismiss={() => setEditDialogHidden(true)}
        dialogContentProps={editDialogProps}
        modalProps={{ isBlocking: true }}
        minWidth={500}
      >
        {editDialogProps.children}
      </Dialog>
      {!publishDialogHidden && (
        <PublishDialog onDismiss={() => setPublishDialogHidden(true)} onSubmit={publish} target={selectedTarget} />
      )}
      {showLog && <LogDialog version={selectedVersion} onDismiss={() => setShowLog(false)} />}
      <ToolBar toolbarItems={toolbarItems} />
      <div css={ContentHeaderStyle}>
        <h1 css={HeaderText}>{selectedTarget ? selectedTargetName : formatMessage('Publish Profiles')}</h1>
      </div>
      <div css={ContentStyle} data-testid="Publish">
        <div css={projectContainer}>
          <div
            key={'_all'}
            onClick={() => {
              setSelectedTarget(undefined);
              onSelectTarget('all');
            }}
            css={selectedTargetName === 'all' ? targetSelected : overflowSet}
            style={{
              height: '36px',
              cursor: 'pointer',
            }}
          >
            {formatMessage('All profiles')}
          </div>
          {settings && settings.publishTargets && (
            <TargetList
              list={settings.publishTargets}
              onSelect={item => {
                setSelectedTarget(item);
                onSelectTarget(item.name);
              }}
              onEdit={async (item, target) => await onEdit(item, target)}
              onDelete={async index => await onDelete(index)}
              selectedTarget={selectedTargetName}
            />
          )}
        </div>
        <div css={contentEditor}>
          <Fragment>
            <PublishStatusList
              items={thisPublishHistory}
              groups={groups}
              onItemClick={setSelectedVersion}
              updateItems={setThisPublishHistory}
            />
            {!thisPublishHistory || thisPublishHistory.length === 0 ? (
              <div style={{ marginLeft: '50px', fontSize: 'smaller', marginTop: '20px' }}>No publish history</div>
            ) : null}
          </Fragment>
        </div>
      </div>
    </Fragment>
  );
};

export default Publish;
const LogDialog = props => {
  const logDialogProps = {
    title: 'Publish Log',
  };
  return (
    <Dialog
      hidden={false}
      onDismiss={props.onDismiss}
      dialogContentProps={logDialogProps}
      modalProps={{ isBlocking: true }}
      minWidth={450}
    >
      <TextField
        value={props && props.version ? props.version.log : ''}
        placeholder="Log Output"
        multiline={true}
        style={{ minHeight: 300 }}
      />
    </Dialog>
  );
};