# Libre Hardware Monitor

Follow the sensors of a Windows PC in Gladys: CPU and GPU temperatures,
loads, fan speeds, power, and, if you wish, clocks, voltages, memory, disks
and network throughputs. Gladys reads them through the web server of
[Libre Hardware Monitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor),
a free program that runs on the PC.

> **Unofficial integration**, not affiliated with the Libre Hardware Monitor
> project. It has **never been tested with a real PC** yet: it was written
> from the format the reference library reads, and tested against simulated
> answers. Your feedback is welcome.

## What you get

- **One device per piece of hardware** (CPU, GPU, motherboard, memory, each
  disk, each network card...), with one read-only feature per sensor.
- **One device for the PC**, whose "Online" feature is 1 while the PC answers
  and 0 when nothing answers at all (PC off, asleep, program closed, network
  down): use it in a scene, for example to be told when the PC turns off. An
  answer with an error (a refused password, another program on the port)
  keeps it at 1: the PC is on, only its sensors are not read.
- **Read only.** Gladys sends nothing to the PC but the reading of the
  sensors: no command, no shutdown, nothing that "turn everything off" or a
  voice assistant could trigger.

Units: temperatures in °C, power in W, voltages in V, currents in A, memory
in GB or MB, throughputs in KB/s, durations in seconds. Gladys has no unit
for a load in %, a fan in RPM or a clock in MHz on these sensors: the unit is
then written in the name of the feature ("CPU Total Load (%)").

## On the PC

1. Install Libre Hardware Monitor (0.9.7 or later recommended; older versions
   work, with less precise values).
2. Run it **as administrator**, or most sensors stay hidden.
3. Menu **Options → Remote Web Server → Run**. The default port is 8085
   (**Options → Remote Web Server → Port** to change it).
4. Let the Windows firewall accept incoming connections on this port, at
   least from the Gladys machine.
5. Give the PC a fixed address in your router, so Gladys always finds it.
6. Tick **Options → Run On Windows Startup** if the PC should be followed
   after every restart.

### Authentication (optional)

Libre Hardware Monitor can ask for a user name and a password
(**Options → Remote Web Server → Authentication**). If you set them, type the
same in Gladys; leave both fields empty otherwise.

Its web server speaks plain **http**: the password crosses your network in
clear, readable by any device on it. Use a password of its own, used nowhere
else. In Gladys, the password is a secret field: kept by Gladys in its
database, never shown again, sent only to Libre Hardware Monitor (HTTP Basic
authentication). It is never written to the logs nor to the `/data` volume
of the integration.

## In Gladys

1. Install the integration from the store, then open its configuration.
2. **Address of the PC**: `192.168.1.20:8085` (a bare address is read as
   http on port 8085). Behind a reverse proxy: `https://host/path`; the
   certificate must then come from a known authority.
3. **Sensors offered**: "Essential" (temperatures, loads, fans, power) or
   "All the sensors". A PC holds hundreds of sensors: start with the
   essential ones.
4. **Reading**: every 30 s, minute (default), 2 or 5 minutes.
5. Save, then press **Test the connection**: it reads the PC at once and
   counts its hardware and sensors.
6. Open the **Discovery** tab and create the devices you want.

Changing "Sensors offered" never removes a feature you already created: a
device keeps all of its features, and the new ones are offered with "Update".

## Limits

- **250 values per minute at most.** Gladys accepts 300 states per minute
  from an integration. Only the values of the devices you created that
  changed are sent (rounded: 0.1 °C, 1 %, 1 RPM, 0.1 W...). On a big PC read
  every 30 seconds, values beyond the budget wait for the next minute, the
  oldest first: every value still arrives, a little later.
- **One PC per integration** in this version.
- A device offers 200 features at most; a reading is limited to 64 pieces of
  hardware and 5,000 sensors, and to 8 MB.
- When the PC does not answer, Gladys tries again after the reading
  interval, then at a growing pace up to every 5 minutes: the "Online"
  feature may take up to 5 minutes to come back to 1 after a long outage.
- A refused password (HTTP 401) stops the readings until you save the
  configuration or press "Test the connection": Gladys never tries the same
  password again by itself.
- An HTTP 429 (too many requests) or a server error (5xx) pauses the
  readings at least for the reading interval (429: 1 min to 6 h); the pause
  is kept across a restart of the integration.
- Moving from Libre Hardware Monitor 0.9.4 or older to 0.9.5 or later changes
  the id of the motherboard (its chip, `lpc-...`, becomes `motherboard`),
  like in Home Assistant: the motherboard appears as a new device in
  Discovery; delete the old one once the new one is created.

## Troubleshooting

| Status                                | What to check                                                                                                                                             |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does not answer                       | PC on? Libre Hardware Monitor running, web server started (Options → Remote Web Server → Run)? Port open in the Windows firewall? Right address and port? |
| Does not answer like the web server   | The port is that of another program, or the web server is off. Open `http://<IP>:8085/data.json` in a browser: you should see JSON.                       |
| Asks for a user name and a password   | Authentication is on in Libre Hardware Monitor: type the same user name and password in Gladys.                                                           |
| Refused the user name or the password | Type them again, save.                                                                                                                                    |
| No sensor                             | Run Libre Hardware Monitor as administrator; check the hardware ticked in its Options menu.                                                               |

## Privacy

The integration only talks to the address you type. It reads the names of
the hardware of the PC and the names of its network cards, which become
names of Gladys devices and features. Nothing leaves your network.
