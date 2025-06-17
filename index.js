import { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    PermissionFlagsBits, 
    ChannelType, 
    SlashCommandBuilder, 
    InteractionType,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    REST,
    Routes,
    MessageFlags
} from 'discord.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Configuración de ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Cargar configuración desde archivo
let config;
try {
    const configPath = join(__dirname, 'config.json');
    config = JSON.parse(readFileSync(configPath, 'utf8'));
} catch (error) {
    console.error('❌ Error cargando config.json:', error.message);
    console.log('📝 Asegúrate de que el archivo config.json existe y está correctamente configurado.');
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages
        // MessageContent y GuildMembers removidos para evitar errores de intents
    ]
});

// Base de datos simple para tickets (en producción usar una BD real)
let ticketsDB = {};
const dbPath = join(__dirname, 'tickets.json');

// Cargar tickets existentes
function loadTickets() {
    try {
        if (existsSync(dbPath)) {
            ticketsDB = JSON.parse(readFileSync(dbPath, 'utf8'));
        }
    } catch (error) {
        console.error('Error cargando tickets:', error);
        ticketsDB = {};
    }
}

// Guardar tickets
function saveTickets() {
    try {
        writeFileSync(dbPath, JSON.stringify(ticketsDB, null, 2));
    } catch (error) {
        console.error('Error guardando tickets:', error);
    }
}

// Verificar si está en horario permitido
function isWithinAllowedHours() {
    // Si el control de horarios está deshabilitado, siempre permitir
    if (!config.settings.enableSchedule) {
        return true;
    }
    
    const now = new Date();
    const currentHour = now.getHours();
    return currentHour >= config.settings.allowedHours.start && currentHour < config.settings.allowedHours.end;
}

// Verificar si un canal existe
async function channelExists(channelId) {
    try {
        const channel = await client.channels.fetch(channelId);
        return !!channel;
    } catch (error) {
        if (error.code === 10003) { // Unknown Channel
            return false;
        }
        throw error;
    }
}

// Generar transcript del canal
async function generateTranscript(channel) {
    try {
        const messages = await channel.messages.fetch({ limit: 100 });
        const sortedMessages = [...messages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
        
        let transcript = `TRANSCRIPT DEL TICKET: ${channel.name}\n`;
        transcript += `Fecha de generación: ${new Date().toLocaleString()}\n`;
        transcript += `${'='.repeat(50)}\n\n`;
        
        for (const msg of sortedMessages) {
            const timestamp = new Date(msg.createdTimestamp).toLocaleString();
            transcript += `[${timestamp}] ${msg.author.tag}: ${msg.content}\n`;
            
            if (msg.embeds.length > 0) {
                transcript += `  📝 Embed: ${msg.embeds[0].title || 'Sin título'}\n`;
            }
            
            if (msg.attachments.size > 0) {
                for (const attachment of msg.attachments.values()) {
                    transcript += `  📎 Archivo: ${attachment.name} (${attachment.url})\n`;
                }
            }
        }
        
        return transcript;
    } catch (error) {
        console.error('Error generando transcript:', error);
        return 'Error al generar el transcript.';
    }
}

// Crear embed de ticket
function createTicketEmbed() {
    return new EmbedBuilder()
        .setColor(config.embeds.colors.primary)
        .setTitle('🧟‍♂️ Soporte LastWayZ Roleplay')
        .setDescription(
            '¡Bienvenido al centro de soporte de **LastWayZ**!\n' +
            'Haz clic en el botón de abajo para abrir un ticket y obtener ayuda del staff.\n\n' +
            '🔻 *Lee las instrucciones antes de abrir un ticket.*'
        )
        .addFields([
            { 
                name: '🕒 Horario de Atención', 
                value: `**${config.settings.allowedHours.start}:00** a **${config.settings.allowedHours.end}:00** (hora del servidor)`, 
                inline: true 
            },
            { 
                name: '📌 Instrucciones', 
                value: 'Describe con claridad tu problema o reporte.\nEvita abrir tickets sin motivo válido.', 
                inline: true 
            },
            {
                name: '📢 Aviso',
                value: 'Los tickets son revisados por orden de llegada. Ten paciencia 🧠🕸️.',
                inline: false
            }
        ])
        .setImage('https://i.ibb.co/S4wHZHYt/ricket.png')
        .setFooter({ text: '🧟 LastWayZ - Sistema de Tickets v2.0', iconURL: 'https://i.imgur.com/T1cZX1x.png' })
        .setTimestamp();
}

// Crear botones para el ticket
function createTicketButtons() {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('create_ticket')
                .setLabel('Crear Ticket')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🎫')
        );
}

// Crear botones para gestión de ticket
function createTicketManageButtons() {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('close_ticket')
                .setLabel('Cerrar Ticket')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🔒'),
            new ButtonBuilder()
                .setCustomId('add_member')
                .setLabel('Agregar Miembro')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('➕'),
            new ButtonBuilder()
                .setCustomId('notify_user')
                .setLabel('Notificar Usuario')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🔔')
        );
}

// Verificar permisos de staff
function isStaff(member) {
    return member.roles.cache.has(config.roles.supportRoleId) || 
           member.roles.cache.has(config.roles.moderatorRoleId) || 
           member.permissions.has(PermissionFlagsBits.Administrator);
}

// Registrar comandos slash
async function registerSlashCommands() {
    const commands = [
        new SlashCommandBuilder()
            .setName('setup-tickets')
            .setDescription('Configura el sistema de tickets')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        
        new SlashCommandBuilder()
            .setName('force-close')
            .setDescription('Fuerza el cierre de un ticket')
            .addChannelOption(option =>
                option.setName('canal')
                    .setDescription('Canal del ticket a cerrar')
                    .setRequired(false))
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

        new SlashCommandBuilder()
            .setName('ticket-stats')
            .setDescription('Muestra estadísticas de tickets')
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
            
        new SlashCommandBuilder()
            .setName('toggle-schedule')
            .setDescription('Activa o desactiva el control de horarios')
            .addBooleanOption(option =>
                option.setName('enabled')
                    .setDescription('true = activar horarios, false = desactivar (24/7)')
                    .setRequired(true))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    ];
    
    const rest = new REST().setToken(config.bot.token);
    
    try {
        console.log('🔄 Actualizando comandos slash...');
        
        await rest.put(
            Routes.applicationGuildCommands(client.user.id, config.bot.guildId),
            { body: commands }
        );
        
        console.log('✅ Comandos slash actualizados exitosamente.');
    } catch (error) {
        console.error('❌ Error actualizando comandos:', error);
    }
}

client.once('ready', async () => {
    console.log(`✅ Bot conectado como ${client.user.tag}`);
    console.log(`📊 Conectado a ${client.guilds.cache.size} servidor(es)`);
    console.log(`👥 Sirviendo a ${client.users.cache.size} usuarios`);
    
    loadTickets();
    await registerSlashCommands();
    
    // Establecer presencia del bot
    client.user.setPresence({
        activities: [{ name: 'tickets de soporte 🎫', type: 3 }],
        status: 'online'
    });
});

client.on('interactionCreate', async (interaction) => {
    try {
        if (interaction.type === InteractionType.ApplicationCommand) {
            await handleSlashCommand(interaction);
        } else if (interaction.isButton()) {
            await handleButtonInteraction(interaction);
        } else if (interaction.isModalSubmit()) {
            await handleModalSubmit(interaction);
        }
    } catch (error) {
        console.error('Error manejando interacción:', error);
        
        const errorMessage = 'Hubo un error procesando tu solicitud. Por favor intenta de nuevo.';
        const errorEmbed = new EmbedBuilder()
            .setColor(config.embeds.colors.error)
            .setTitle('❌ Error')
            .setDescription(errorMessage)
            .setTimestamp();

        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        } else {
            await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        }
    }
});

async function handleSlashCommand(interaction) {
    const { commandName } = interaction;
    
    switch (commandName) {
        case 'setup-tickets':
            await setupTicketsCommand(interaction);
            break;
        case 'force-close':
            await forceCloseCommand(interaction);
            break;
        case 'ticket-stats':
            await ticketStatsCommand(interaction);
            break;
        case 'toggle-schedule':
            await toggleScheduleCommand(interaction);
            break;
    }
}

async function setupTicketsCommand(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        const errorEmbed = new EmbedBuilder()
            .setColor(config.embeds.colors.error)
            .setTitle('❌ Sin Permisos')
            .setDescription('No tienes permisos para usar este comando.')
            .setTimestamp();
        
        return await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
    }
    
    const embed = createTicketEmbed();
    const buttons = createTicketButtons();
    
    const channel = client.channels.cache.get(config.channels.ticketChannelId);
    if (channel) {
        await channel.send({ embeds: [embed], components: [buttons] });
        
        const successEmbed = new EmbedBuilder()
            .setColor(config.embeds.colors.success)
            .setTitle('✅ Sistema Configurado')
            .setDescription(`Sistema de tickets configurado correctamente en ${channel}.`)
            .setTimestamp();
        
        await interaction.reply({ embeds: [successEmbed], flags: MessageFlags.Ephemeral });
    } else {
        const errorEmbed = new EmbedBuilder()
            .setColor(config.embeds.colors.error)
            .setTitle('❌ Canal No Encontrado')
            .setDescription('No se pudo encontrar el canal configurado para tickets.')
            .setTimestamp();
        
        await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
    }
}

async function forceCloseCommand(interaction) {
    if (!isStaff(interaction.member)) {
        const errorEmbed = new EmbedBuilder()
            .setColor(config.embeds.colors.error)
            .setTitle('❌ Sin Permisos')
            .setDescription('No tienes permisos para usar este comando.')
            .setTimestamp();
        
        return await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
    }
    
    const channel = interaction.options.getChannel('canal') || interaction.channel;
    const ticketData = Object.values(ticketsDB).find(ticket => ticket.channelId === channel.id);
    
    if (!ticketData) {
        const errorEmbed = new EmbedBuilder()
            .setColor(config.embeds.colors.error)
            .setTitle('❌ Ticket No Válido')
            .setDescription('Este no es un canal de ticket válido.')
            .setTimestamp();
        
        return await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
    }
    
    const processingEmbed = new EmbedBuilder()
        .setColor(config.embeds.colors.warning)
        .setTitle('🔄 Procesando')
        .setDescription('Cerrando ticket y generando transcript...')
        .setTimestamp();
    
    await interaction.reply({ embeds: [processingEmbed], flags: MessageFlags.Ephemeral });
    await closeTicket(channel, interaction.user, ticketData);
}

async function ticketStatsCommand(interaction) {
    if (!isStaff(interaction.member)) {
        const errorEmbed = new EmbedBuilder()
            .setColor(config.embeds.colors.error)
            .setTitle('❌ Sin Permisos')
            .setDescription('No tienes permisos para usar este comando.')
            .setTimestamp();
        
        return await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
    }
    
    const tickets = Object.values(ticketsDB);
    const openTickets = tickets.filter(ticket => ticket.status === 'open').length;
    const closedTickets = tickets.filter(ticket => ticket.status === 'closed').length;
    const totalTickets = tickets.length;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const ticketsToday = tickets.filter(ticket => 
        new Date(ticket.createdAt) >= today
    ).length;
    
    const statsEmbed = new EmbedBuilder()
        .setColor(config.embeds.colors.info)
        .setTitle('📊 Estadísticas de Tickets')
        .addFields([
            { name: '🎫 Total de Tickets', value: totalTickets.toString(), inline: true },
            { name: '🟢 Tickets Abiertos', value: openTickets.toString(), inline: true },
            { name: '🔴 Tickets Cerrados', value: closedTickets.toString(), inline: true },
            { name: '📅 Tickets Hoy', value: ticketsToday.toString(), inline: true },
            { 
                name: '⏰ Estado del Horario', 
                value: config.settings.enableSchedule 
                    ? (isWithinAllowedHours() ? '✅ Abierto' : '❌ Cerrado')
                    : '🕒 24/7 Siempre Abierto', 
                inline: true 
            },
            { 
                name: config.settings.enableSchedule ? '🕒 Próxima Apertura' : '🔧 Configuración',
                value: config.settings.enableSchedule 
                    ? `${config.settings.allowedHours.start}:00`
                    : 'Horarios deshabilitados', 
                inline: true 
            }
        ])
        .setTimestamp();
    
    await interaction.reply({ embeds: [statsEmbed], flags: MessageFlags.Ephemeral });
}

async function toggleScheduleCommand(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        const errorEmbed = new EmbedBuilder()
            .setColor(config.embeds.colors.error)
            .setTitle('❌ Sin Permisos')
            .setDescription('Solo los administradores pueden cambiar la configuración de horarios.')
            .setTimestamp();
        
        return await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
    }
    
    const enabled = interaction.options.getBoolean('enabled');
    const previousState = config.settings.enableSchedule;
    
    // Actualizar configuración
    config.settings.enableSchedule = enabled;
    
    // Guardar configuración actualizada
    try {
        const configPath = join(__dirname, 'config.json');
        writeFileSync(configPath, JSON.stringify(config, null, 2));
    } catch (error) {
        console.error('Error guardando configuración:', error);
        const errorEmbed = new EmbedBuilder()
            .setColor(config.embeds.colors.error)
            .setTitle('❌ Error al Guardar')
            .setDescription('No se pudo guardar la configuración. Contacta al desarrollador.')
            .setTimestamp();
        
        return await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
    }
    
    // Crear embed de confirmación
    const statusEmbed = new EmbedBuilder()
        .setColor(enabled ? config.embeds.colors.warning : config.embeds.colors.success)
        .setTitle('🔄 Configuración de Horarios Actualizada')
        .setDescription(`El control de horarios ha sido **${enabled ? 'ACTIVADO' : 'DESACTIVADO'}**.`)
        .addFields([
            { 
                name: '⚙️ Estado Anterior', 
                value: previousState ? '✅ Activado' : '❌ Desactivado', 
                inline: true 
            },
            { 
                name: '🆕 Estado Actual', 
                value: enabled ? '✅ Activado' : '❌ Desactivado', 
                inline: true 
            },
            {
                name: '📋 Descripción',
                value: enabled 
                    ? `Los tickets solo se podrán crear entre las **${config.settings.allowedHours.start}:00** y **${config.settings.allowedHours.end}:00**.`
                    : 'Los tickets se pueden crear **24/7** sin restricciones de horario.',
                inline: false
            }
        ])
        .setFooter({ text: 'Cambio aplicado inmediatamente' })
        .setTimestamp();
    
    await interaction.reply({ embeds: [statusEmbed], flags: MessageFlags.Ephemeral });
    
    // Log del cambio
    const logChannel = client.channels.cache.get(config.channels.logChannelId);
    if (logChannel) {
        const logEmbed = new EmbedBuilder()
            .setColor(config.embeds.colors.info)
            .setTitle('⚙️ Configuración Modificada')
            .setDescription(`${interaction.user.tag} ${enabled ? 'activó' : 'desactivó'} el control de horarios.`)
            .addFields([
                { name: 'Usuario', value: `${interaction.user.tag} (${interaction.user.id})`, inline: true },
                { name: 'Acción', value: enabled ? 'Activar Horarios' : 'Desactivar Horarios', inline: true },
                { name: 'Estado', value: enabled ? '🕒 Horarios Activos' : '🌐 24/7 Disponible', inline: true }
            ])
            .setThumbnail(interaction.user.displayAvatarURL())
            .setTimestamp();
        
        await logChannel.send({ embeds: [logEmbed] });
    }
}

async function handleButtonInteraction(interaction) {
    const { customId } = interaction;
    
    switch (customId) {
        case 'create_ticket':
            await createTicket(interaction);
            break;
        case 'close_ticket':
            await handleCloseTicket(interaction);
            break;
        case 'add_member':
            await handleAddMember(interaction);
            break;
        case 'notify_user':
            await handleNotifyUser(interaction);
            break;
    }
}

async function createTicket(interaction) {
    const userId = interaction.user.id;
    
    // Verificar si ya tiene un ticket abierto
    const existingTicket = Object.values(ticketsDB).find(
        ticket => ticket.userId === userId && ticket.status === 'open'
    );
    
    if (existingTicket) {
        const errorEmbed = new EmbedBuilder()
            .setColor(config.embeds.colors.error)
            .setTitle('❌ Ticket Existente')
            .setDescription(`Ya tienes un ticket abierto: <#${existingTicket.channelId}>`)
            .setTimestamp();
        
        return await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
    }
    
    // Verificar horario (solo si está habilitado)
    if (config.settings.enableSchedule && !isWithinAllowedHours()) {
        const errorEmbed = new EmbedBuilder()
            .setColor(config.embeds.colors.error)
            .setTitle('❌ Fuera de Horario')
            .setDescription(config.messages.outsideHours
                .replace('{start}', config.settings.allowedHours.start)
                .replace('{end}', config.settings.allowedHours.end))
            .setTimestamp();
        
        return await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
    }
    
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    
    try {
        const guild = interaction.guild;
        const category = guild.channels.cache.get(config.channels.categoryId);
        
        // Crear canal del ticket con permisos modernos
        const ticketChannel = await guild.channels.create({
            name: `ticket-${interaction.user.username}`,
            type: ChannelType.GuildText,
            parent: category,
            permissionOverwrites: [
                {
                    id: guild.id,
                    deny: [PermissionFlagsBits.ViewChannel]
                },
                {
                    id: interaction.user.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory,
                        PermissionFlagsBits.AttachFiles,
                        PermissionFlagsBits.EmbedLinks
                    ]
                },
                {
                    id: config.roles.supportRoleId,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory,
                        PermissionFlagsBits.ManageMessages,
                        PermissionFlagsBits.AttachFiles,
                        PermissionFlagsBits.EmbedLinks
                    ]
                },
                {
                    id: config.roles.moderatorRoleId,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory,
                        PermissionFlagsBits.ManageMessages,
                        PermissionFlagsBits.ManageChannels,
                        PermissionFlagsBits.AttachFiles,
                        PermissionFlagsBits.EmbedLinks
                    ]
                }
            ]
        });
        
        // Crear registro del ticket
        const ticketId = `ticket_${Date.now()}`;
        ticketsDB[ticketId] = {
            id: ticketId,
            userId: interaction.user.id,
            channelId: ticketChannel.id,
            status: 'open',
            createdAt: new Date().toISOString(),
            messages: []
        };
        
        saveTickets();
        
        // Embed de bienvenida mejorado
        const welcomeEmbed = new EmbedBuilder()
            .setColor(config.embeds.colors.success)
            .setTitle('🎫 Ticket Creado Exitosamente')
            .setDescription(`¡Hola ${interaction.user}! Tu ticket ha sido creado.`)
            .addFields([
                { 
                    name: '📝 Instrucciones', 
                    value: 'Describe tu problema detalladamente. Nuestro equipo te atenderá pronto.', 
                    inline: false 
                },
                { 
                    name: '⏰ Tiempo de Respuesta', 
                    value: 'Normalmente respondemos en 1-24 horas.', 
                    inline: true 
                },
                { 
                    name: '🔔 Notificaciones', 
                    value: 'Recibirás un DM con actualizaciones.', 
                    inline: true 
                }
            ])
            .setFooter({ text: `Ticket ID: ${ticketId} | Sistema v2.0` })
            .setTimestamp();
        
        const manageButtons = createTicketManageButtons();
        
        await ticketChannel.send({
            content: `${interaction.user} <@&${config.roles.supportRoleId}>`,
            embeds: [welcomeEmbed],
            components: [manageButtons]
        });
        
        const successEmbed = new EmbedBuilder()
            .setColor(config.embeds.colors.success)
            .setTitle('✅ Ticket Creado')
            .setDescription(`Tu ticket ha sido creado: ${ticketChannel}`)
            .setTimestamp();
        
        await interaction.editReply({ embeds: [successEmbed] });
        
        // Log mejorado
        const logChannel = client.channels.cache.get(config.channels.logChannelId);
        if (logChannel) {
            const logEmbed = new EmbedBuilder()
                .setColor(config.embeds.colors.info)
                .setTitle('📊 Nuevo Ticket Creado')
                .addFields([
                    { name: 'Usuario', value: `${interaction.user.tag} (${interaction.user.id})`, inline: true },
                    { name: 'Canal', value: `${ticketChannel}`, inline: true },
                    { name: 'Ticket ID', value: ticketId, inline: true },
                    { name: 'Hora', value: new Date().toLocaleString(), inline: false }
                ])
                .setThumbnail(interaction.user.displayAvatarURL())
                .setTimestamp();
            
            await logChannel.send({ embeds: [logEmbed] });
        }
        
    } catch (error) {
        console.error('Error creando ticket:', error);
        
        const errorEmbed = new EmbedBuilder()
            .setColor(config.embeds.colors.error)
            .setTitle('❌ Error al Crear Ticket')
            .setDescription('Hubo un error creando tu ticket. Por favor intenta de nuevo.')
            .setTimestamp();
        
        await interaction.editReply({ embeds: [errorEmbed] });
    }
}

async function handleCloseTicket(interaction) {
    if (!isStaff(interaction.member)) {
        const errorEmbed = new EmbedBuilder()
            .setColor(config.embeds.colors.error)
            .setTitle('❌ Sin Permisos')
            .setDescription('Solo el staff puede cerrar tickets.')
            .setTimestamp();
        
        return await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
    }
    
    const ticketData = Object.values(ticketsDB).find(
        ticket => ticket.channelId === interaction.channel.id
    );
    
    if (!ticketData) {
        const errorEmbed = new EmbedBuilder()
            .setColor(config.embeds.colors.error)
            .setTitle('❌ Ticket No Válido')
            .setDescription('Este no es un canal de ticket válido.')
            .setTimestamp();
        
        return await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
    }
    
    const processingEmbed = new EmbedBuilder()
        .setColor(config.embeds.colors.warning)
        .setTitle('🔄 Cerrando Ticket')
        .setDescription('Generando transcript y cerrando ticket...')
        .setTimestamp();
    
    await interaction.reply({ embeds: [processingEmbed], flags: MessageFlags.Ephemeral });
    await closeTicket(interaction.channel, interaction.user, ticketData);
}

async function handleAddMember(interaction) {
    if (!isStaff(interaction.member)) {
        const errorEmbed = new EmbedBuilder()
            .setColor(config.embeds.colors.error)
            .setTitle('❌ Sin Permisos')
            .setDescription('Solo el staff puede agregar miembros.')
            .setTimestamp();
        
        return await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
    }
    
    const modal = new ModalBuilder()
        .setCustomId('add_member_modal')
        .setTitle('Agregar Miembro al Ticket');
    
    const userInput = new TextInputBuilder()
        .setCustomId('user_input')
        .setLabel('ID o Mención del Usuario')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Ejemplo: 123456789012345678 o @usuario')
        .setRequired(true);
    
    const firstActionRow = new ActionRowBuilder().addComponents(userInput);
    modal.addComponents(firstActionRow);
    
    await interaction.showModal(modal);
}

async function handleNotifyUser(interaction) {
    if (!isStaff(interaction.member)) {
        const errorEmbed = new EmbedBuilder()
            .setColor(config.embeds.colors.error)
            .setTitle('❌ Sin Permisos')
            .setDescription('Solo el staff puede enviar notificaciones.')
            .setTimestamp();
        
        return await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
    }
    
    const ticketData = Object.values(ticketsDB).find(
        ticket => ticket.channelId === interaction.channel.id
    );
    
    if (!ticketData) {
        const errorEmbed = new EmbedBuilder()
            .setColor(config.embeds.colors.error)
            .setTitle('❌ Ticket No Válido')
            .setDescription('Este no es un canal de ticket válido.')
            .setTimestamp();
        
        return await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
    }
    
    try {
        const user = await client.users.fetch(ticketData.userId);
        
        const notifyEmbed = new EmbedBuilder()
            .setColor(config.embeds.colors.warning)
            .setTitle('🔔 Respuesta Requerida en tu Ticket')
            .setDescription(`Hola ${user.username}, necesitamos que respondas en tu ticket de soporte.`)
            .addFields([
                { name: 'Canal del Ticket', value: `<#${interaction.channel.id}>`, inline: true },
                { name: 'Solicitado por', value: interaction.user.tag, inline: true },
                { name: 'Hora', value: new Date().toLocaleString(), inline: true }
            ])
            .setThumbnail(interaction.guild.iconURL())
            .setTimestamp();
        
        await user.send({ embeds: [notifyEmbed] });
        
        const successEmbed = new EmbedBuilder()
            .setColor(config.embeds.colors.success)
            .setTitle('✅ Notificación Enviada')
            .setDescription(`Notificación enviada exitosamente a ${user.tag}`)
            .setTimestamp();
        
        await interaction.reply({ embeds: [successEmbed], flags: MessageFlags.Ephemeral });
        
    } catch (error) {
        console.error('Error enviando notificación:', error);
        
        const errorEmbed = new EmbedBuilder()
            .setColor(config.embeds.colors.error)
            .setTitle('❌ Error al Notificar')
            .setDescription('No se pudo enviar la notificación al usuario. Es posible que tenga los DMs desactivados.')
            .setTimestamp();
        
        await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
    }
}

async function handleModalSubmit(interaction) {
    if (interaction.customId === 'add_member_modal') {
        const userInput = interaction.fields.getTextInputValue('user_input');
        
        try {
            // Extraer ID del usuario
            let userId = userInput.replace(/[<@!>]/g, '');
            
            const user = await client.users.fetch(userId);
            let member;
            
            try {
                member = await interaction.guild.members.fetch(userId);
            } catch (error) {
                // Si no se puede obtener el miembro, usar fetch básico
                console.log('No se pudo obtener información completa del miembro');
            }
            
            // Agregar permisos al canal
            if (member) {
                await interaction.channel.permissionOverwrites.edit(member, {
                    ViewChannel: true,
                    SendMessages: true,
                    ReadMessageHistory: true,
                    AttachFiles: true,
                    EmbedLinks: true
                });
            } else {
                // Si no se puede obtener el miembro, agregar por ID de usuario
                await interaction.channel.permissionOverwrites.edit(userId, {
                    ViewChannel: true,
                    SendMessages: true,
                    ReadMessageHistory: true,
                    AttachFiles: true,
                    EmbedLinks: true
                });
            }
            
            const successEmbed = new EmbedBuilder()
                .setColor(config.embeds.colors.success)
                .setTitle('✅ Miembro Agregado')
                .setDescription(`${user.tag} ha sido agregado al ticket exitosamente.`)
                .setTimestamp();
            
            await interaction.reply({ embeds: [successEmbed], flags: MessageFlags.Ephemeral });
            
            // Notificar en el canal
            const notificationEmbed = new EmbedBuilder()
                .setColor(config.embeds.colors.success)
                .setDescription(`➕ ${user} ha sido agregado al ticket por ${interaction.user}`)
                .setTimestamp();
            
            await interaction.channel.send({ embeds: [notificationEmbed] });
            
        } catch (error) {
            console.error('Error agregando miembro:', error);
            
            const errorEmbed = new EmbedBuilder()
                .setColor(config.embeds.colors.error)
                .setTitle('❌ Error al Agregar Miembro')
                .setDescription('No se pudo agregar el usuario. Verifica que el ID o mención sea correcta.')
                .setTimestamp();
            
            await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        }
    }
}

async function closeTicket(channel, closedBy, ticketData) {
    try {
        // Verificar que el canal aún existe antes de proceder
        const channelExists = await channelExists(channel.id);
        if (!channelExists) {
            console.log(`⚠️ El canal ${channel.id} ya no existe, omitiendo cierre.`);
            // Actualizar la base de datos para marcar como cerrado
            ticketData.status = 'closed';
            ticketData.closedAt = new Date().toISOString();
            ticketData.closedBy = closedBy.id;
            saveTickets();
            return;
        }

        // Generar transcript
        const transcript = await generateTranscript(channel);
        
        // Enviar transcript al usuario
        const user = await client.users.fetch(ticketData.userId);
        if (user) {
            const transcriptEmbed = new EmbedBuilder()
                .setColor(config.embeds.colors.warning)
                .setTitle('🎫 Ticket Cerrado')
                .setDescription('Tu ticket ha sido cerrado. Aquí tienes el transcript de la conversación.')
                .addFields([
                    { name: 'Cerrado por', value: closedBy.tag, inline: true },
                    { name: 'Fecha de cierre', value: new Date().toLocaleString(), inline: true },
                    { name: 'Duración', value: calculateTicketDuration(ticketData.createdAt), inline: true }
                ])
                .setThumbnail(closedBy.displayAvatarURL())
                .setTimestamp();
            
            const transcriptBuffer = Buffer.from(transcript, 'utf-8');
            
            try {
                await user.send({
                    embeds: [transcriptEmbed],
                    files: [{
                        attachment: transcriptBuffer,
                        name: `transcript-${channel.name}.txt`
                    }]
                });
            } catch (dmError) {
                console.log(`No se pudo enviar DM a ${user.tag}:`, dmError.message);
            }
        }
        
        // Actualizar base de datos
        ticketData.status = 'closed';
        ticketData.closedAt = new Date().toISOString();
        ticketData.closedBy = closedBy.id;
        saveTickets();
        
        // Log mejorado
        const logChannel = client.channels.cache.get(config.channels.logChannelId);
        if (logChannel) {
            const logEmbed = new EmbedBuilder()
                .setColor(config.embeds.colors.error)
                .setTitle('🔒 Ticket Cerrado')
                .addFields([
                    { name: 'Ticket', value: channel.name, inline: true },
                    { name: 'Usuario', value: `<@${ticketData.userId}>`, inline: true },
                    { name: 'Cerrado por', value: closedBy.tag, inline: true },
                    { name: 'Duración', value: calculateTicketDuration(ticketData.createdAt), inline: true },
                    { name: 'Transcript', value: 'Enviado por DM al usuario', inline: true }
                ])
                .setThumbnail(closedBy.displayAvatarURL())
                .setTimestamp();
            
            await logChannel.send({ embeds: [logEmbed] });
        }
        
        // Eliminar canal después del delay configurado con verificación adicional
        setTimeout(async () => {
            try {
                // Verificar nuevamente que el canal existe antes de eliminarlo
                const stillExists = await channelExists(channel.id);
                if (stillExists) {
                    const channelToDelete = await client.channels.fetch(channel.id);
                    await channelToDelete.delete('Ticket cerrado automáticamente');
                    console.log(`✅ Canal ${channel.name} eliminado exitosamente.`);
                } else {
                    console.log(`⚠️ El canal ${channel.id} ya no existe al momento de eliminación.`);
                }
            } catch (error) {
                // Manejo específico para diferentes tipos de errores
                if (error.code === 10003) {
                    console.log(`ℹ️ El canal ${channel.id} ya fue eliminado anteriormente.`);
                } else {
                    console.error('Error eliminando canal:', error);
                }
            }
        }, config.settings.deleteChannelDelay);
        
    } catch (error) {
        console.error('Error cerrando ticket:', error);
    }
}

// Función auxiliar para calcular duración del ticket
function calculateTicketDuration(createdAt) {
    const created = new Date(createdAt);
    const now = new Date();
    const diffMs = now - created;
    
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    
    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

// Manejo mejorado de errores
client.on('error', (error) => {
    console.error('❌ Error del cliente:', error);
});

client.on('warn', (warning) => {
    console.warn('⚠️ Advertencia:', warning);
});

// Manejo de señales del sistema para cierre graceful
process.on('SIGINT', () => {
    console.log('🔄 Cerrando bot gracefully...');
    saveTickets();
    client.destroy();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('🔄 Cerrando bot gracefully...');
    saveTickets();
    client.destroy();
    process.exit(0);
});

// Iniciar el bot
client.login(config.bot.token).catch(error => {
    console.error('❌ Error al iniciar el bot:', error);
    process.exit(1);
});
