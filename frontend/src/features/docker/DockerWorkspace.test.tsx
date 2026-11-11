import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import DockerWorkspace, { type DockerTarget } from './DockerWorkspace';

const api = vi.hoisted(() => ({ list: vi.fn(), inspect: vi.fn(), stats: vi.fn() }));
vi.mock('../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice', () => ({
  ListContainers: api.list,
  InspectContainer: api.inspect,
  ReadContainerStats: api.stats,
  ChangeContainerState: vi.fn(),
  CloseContainerTerminal: vi.fn(),
  OpenContainerTerminal: vi.fn(),
  SetDockerSocket: vi.fn(),
  StartTunnel: vi.fn(),
}));
vi.mock('@wailsio/runtime', () => ({
  Events: {
    On: () => () => {},
    Types: { Common: {} },
  },
}));
vi.mock('../terminal/TerminalView', () => ({ default: () => null }));
vi.mock('../logs/LogSourcePane', () => ({ default: () => null }));

const firstHost: DockerTarget = { id: 'host-1', name: 'First', address: 'user@first.invalid:22' };
const secondHost: DockerTarget = {
  id: 'host-2',
  name: 'Second',
  address: 'user@second.invalid:22',
};
const containers = ['web', 'worker'].map((name, index) => ({
  id: `container-${index + 1}`,
  name,
  image: 'app:latest',
  state: 'running',
  status: 'Up',
  project: '',
  ports: [],
}));
function response<T>(value: T) {
  return Object.assign(Promise.resolve(value), { cancel: vi.fn() });
}
function setup(
  request = { workspace: firstHost.id, container: containers[0].id },
  targets = [firstHost],
) {
  const props = {
    open: true,
    targets,
    request,
    fontSize: 14,
    onDirectory: vi.fn(),
    onSocketSaved: vi.fn(),
    onLogs: vi.fn(),
    onError: vi.fn(),
  };
  return { props, ...render(<DockerWorkspace {...props} />) };
}
function tab(name: string) {
  return within(screen.getByRole('navigation', { name: 'Container views' })).getByRole('button', {
    name,
  });
}
async function loaded() {
  await screen.findByRole('region', { name: 'web' });
  await waitFor(() => expect(api.inspect).toHaveBeenCalled());
}

beforeEach(() => {
  vi.resetAllMocks();
  api.list.mockImplementation(() => response(containers));
  api.inspect.mockImplementation(() =>
    response({
      mounts: [],
      tty: false,
      health: '',
      health_log: '',
      exit_code: 0,
      oom_killed: false,
      error: '',
      finished_at: '',
      restart_count: 0,
    }),
  );
  api.stats.mockImplementation(() => response({ time: new Date().toISOString() }));
});

test.each(['Logs', 'Terminal', 'Mounts and ports'])(
  '%s remains selected without reloading containers when the parent updates targets',
  async (name) => {
    const user = userEvent.setup();
    const { props, rerender } = setup();
    await loaded();
    await user.click(tab(name));
    const listCalls = api.list.mock.calls.length;
    const detailCalls = api.inspect.mock.calls.length;

    for (const targets of [[{ ...firstHost }], [{ ...firstHost }, secondHost]]) {
      rerender(<DockerWorkspace {...props} targets={targets} />);
      expect(tab(name).getAttribute('aria-current')).toBe('page');
      expect(api.list).toHaveBeenCalledTimes(listCalls);
      expect(api.inspect).toHaveBeenCalledTimes(detailCalls);
    }
  },
);

test('target updates preserve a manually selected host and container after an opening request', async () => {
  const user = userEvent.setup();
  const { props, rerender } = setup(undefined, [firstHost, secondHost]);
  await loaded();
  await user.click(screen.getByRole('button', { name: /SSH workspace$/ }));
  await user.click(await screen.findByRole('option', { name: /^Second/ }));
  await screen.findByRole('region', { name: 'web' });
  await user.click(screen.getByRole('button', { name: /^worker\s*app:latest/ }));
  await user.click(tab('Terminal'));
  const listCalls = api.list.mock.calls.length;
  const detailCalls = api.inspect.mock.calls.length;

  rerender(<DockerWorkspace {...props} targets={[{ ...firstHost }, { ...secondHost }]} />);
  expect(screen.getByRole('button', { name: /^Second.*SSH workspace$/ })).toBeTruthy();
  expect(screen.getByRole('region', { name: 'worker' })).toBeTruthy();
  expect(tab('Terminal').getAttribute('aria-current')).toBe('page');
  expect(api.list).toHaveBeenCalledTimes(listCalls);
  expect(api.inspect).toHaveBeenCalledTimes(detailCalls);
});

test('a new explicit request for the same resource returns to overview and refreshes once', async () => {
  const user = userEvent.setup();
  const { props, rerender } = setup();
  await loaded();
  await user.click(tab('Logs'));
  const listCalls = api.list.mock.calls.length;
  const request = { ...props.request };

  rerender(<DockerWorkspace {...props} request={request} />);
  await waitFor(() => expect(api.list).toHaveBeenCalledTimes(listCalls + 1));
  expect(tab('Overview').getAttribute('aria-current')).toBe('page');
  await user.click(tab('Logs'));
  rerender(<DockerWorkspace {...props} request={request} targets={[{ ...firstHost }]} />);
  expect(tab('Logs').getAttribute('aria-current')).toBe('page');
  expect(api.list).toHaveBeenCalledTimes(listCalls + 1);
});

test('an opening request waits for its target and is consumed when that target appears', async () => {
  const { props, rerender } = setup({ workspace: secondHost.id, container: containers[1].id }, [
    firstHost,
  ]);
  expect(api.list).not.toHaveBeenCalled();

  rerender(<DockerWorkspace {...props} targets={[firstHost, secondHost]} />);
  await screen.findByRole('region', { name: 'worker' });
  await waitFor(() =>
    expect(api.inspect).toHaveBeenCalledWith(
      secondHost.id,
      '/var/run/docker.sock',
      containers[1].id,
    ),
  );
  const listCalls = api.list.mock.calls.length;
  rerender(<DockerWorkspace {...props} targets={[{ ...firstHost }, { ...secondHost }]} />);
  expect(api.list).toHaveBeenCalledTimes(listCalls);
});
